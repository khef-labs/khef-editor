'use strict'

// Workspace-root path confinement — the security seam from the design doc (§7.3 #2,
// ctx-security-pre-analysis #2). Every fs operation routes through here so reads,
// writes, creates, and renames cannot escape the currently-open workspace root, even
// via symlinks.
//
// Multi-window: the workspace root is PER WINDOW, keyed by the renderer's
// webContents.id (`wcId`). Every function takes `wcId` as its first argument so two
// windows open on different repos each confine to their own root — there is no shared
// "current root" global that a second window could clobber. Callers MUST pass the id
// of the actual IPC event sender (`event.sender.id`), never a focused-window lookup,
// so concurrent IPC from two windows cannot race on a shared value.
//
// Rules (unchanged, now scoped per window):
//   - Resolve the workspace root once with fs.realpath (stored as roots.get(wcId)).
//   - Existing targets: realpath the target, then containment-check.
//   - New targets (write/create/rename dest): the path does not exist yet, so
//     fs.realpath on it throws. Instead realpath the NEAREST EXISTING ANCESTOR,
//     containment-check that, then append the remaining (non-existent) segments
//     lexically.
//   - Containment uses path.relative (not prefix matching) so /foo/bar2 cannot pass
//     a /foo/bar root check.

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

// wcId (webContents.id) → realpath'd absolute workspace root. Absent when that window
// has no folder open. Entries are cleared by main.cjs when a window is destroyed.
const roots = new Map()

function expandTilde(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** Validate a webContents id. Ids are positive integers assigned by Electron. */
function assertWcId(wcId) {
  if (!Number.isInteger(wcId) || wcId <= 0) {
    throw new Error('Invalid window id')
  }
}

/**
 * Set (open) the workspace root for a window. Resolves and realpaths it. Throws if it
 * does not exist or is not a directory.
 * @param {number} wcId  webContents.id of the window opening the folder
 * @param {string} dir
 * @returns {Promise<string>} the realpath'd root
 */
async function setWorkspaceRoot(wcId, dir) {
  assertWcId(wcId)
  const abs = path.resolve(expandTilde(dir))
  const real = await fsp.realpath(abs)
  const st = await fsp.stat(real)
  if (!st.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${dir}`)
  }
  roots.set(wcId, real)
  return real
}

/** The realpath'd root for a window, or null when none is open. */
function getWorkspaceRoot(wcId) {
  return roots.get(wcId) ?? null
}

/** Drop a window's root (called on window destroy). No-op if absent. */
function clearWorkspaceRoot(wcId) {
  roots.delete(wcId)
}

/** True when `child` is the window's root itself or strictly inside it. */
function isInsideRoot(wcId, childReal) {
  const rootReal = roots.get(wcId)
  if (!rootReal) return false
  if (childReal === rootReal) return true
  const rel = path.relative(rootReal, childReal)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Walk up from `target` to the nearest ancestor that exists on disk. Returns
 * { existing, rest } where `existing` is that ancestor (pre-realpath) and `rest` is
 * the array of trailing segments that do not yet exist.
 */
async function nearestExistingAncestor(target) {
  let current = target
  const rest = []
  // Guard against an unbounded climb; filesystem depth is bounded in practice.
  for (let i = 0; i < 4096; i++) {
    try {
      await fsp.stat(current)
      return { existing: current, rest: rest.reverse() }
    } catch {
      const parent = path.dirname(current)
      if (parent === current) {
        // Reached the filesystem root without finding an existing ancestor.
        return { existing: current, rest: rest.reverse() }
      }
      rest.push(path.basename(current))
      current = parent
    }
  }
  throw new Error('Path too deep to resolve')
}

/**
 * Resolve a path for an operation on an EXISTING target (read, stat, delete, etc.).
 * Realpaths the target and confines it to the window's root. Throws on escape.
 * @param {number} wcId
 * @param {string} requested
 * @returns {Promise<string>} the realpath'd, confined absolute path
 */
async function resolveExisting(wcId, requested) {
  const rootReal = roots.get(wcId)
  if (!rootReal) throw new Error('No workspace open')
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new Error('Path must be a non-empty string')
  }
  const abs = path.resolve(rootReal, expandTilde(requested))
  const real = await fsp.realpath(abs)
  if (!isInsideRoot(wcId, real)) {
    throw new Error('Path is outside the workspace root')
  }
  return real
}

/**
 * Resolve a path for a NEW target (write/create/rename destination) that may not
 * exist yet. Realpaths the nearest existing ancestor, confines THAT to the window's
 * root, then appends the non-existent trailing segments lexically.
 * @param {number} wcId
 * @param {string} requested
 * @returns {Promise<string>} the confined absolute path (may not exist yet)
 */
async function resolveForWrite(wcId, requested) {
  const rootReal = roots.get(wcId)
  if (!rootReal) throw new Error('No workspace open')
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new Error('Path must be a non-empty string')
  }
  const abs = path.resolve(rootReal, expandTilde(requested))
  const { existing, rest } = await nearestExistingAncestor(abs)
  const existingReal = await fsp.realpath(existing)
  if (!isInsideRoot(wcId, existingReal)) {
    throw new Error('Path is outside the workspace root')
  }
  const candidate = rest.length ? path.join(existingReal, ...rest) : existingReal
  // Final lexical guard on the assembled candidate (defense in depth — the ancestor
  // is already confined and `rest` are plain basenames from the requested path).
  if (!isInsideRoot(wcId, candidate) && candidate !== existingReal) {
    throw new Error('Path is outside the workspace root')
  }
  return candidate
}

module.exports = {
  setWorkspaceRoot,
  getWorkspaceRoot,
  clearWorkspaceRoot,
  isInsideRoot,
  resolveExisting,
  resolveForWrite,
  expandTilde,
}
