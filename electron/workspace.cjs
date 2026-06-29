'use strict'

// Workspace-root path confinement — the security seam from the design doc (§7.3 #2,
// ctx-security-pre-analysis #2). Every fs operation routes through here so reads,
// writes, creates, and renames cannot escape the currently-open workspace root, even
// via symlinks.
//
// Rules:
//   - Resolve the workspace root once with fs.realpath (rootReal).
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

let rootReal = null // realpath'd absolute workspace root, or null when none is open

function expandTilde(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

/**
 * Set (open) the workspace root. Resolves and realpaths it. Throws if it does not
 * exist or is not a directory.
 * @param {string} dir
 * @returns {Promise<string>} the realpath'd root
 */
async function setWorkspaceRoot(dir) {
  const abs = path.resolve(expandTilde(dir))
  const real = await fsp.realpath(abs)
  const st = await fsp.stat(real)
  if (!st.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${dir}`)
  }
  rootReal = real
  return rootReal
}

function getWorkspaceRoot() {
  return rootReal
}

function clearWorkspaceRoot() {
  rootReal = null
}

/** True when `child` is the root itself or strictly inside it. */
function isInsideRoot(childReal) {
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
 * Realpaths the target and confines it to the root. Throws on escape.
 * @param {string} requested
 * @returns {Promise<string>} the realpath'd, confined absolute path
 */
async function resolveExisting(requested) {
  if (!rootReal) throw new Error('No workspace open')
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new Error('Path must be a non-empty string')
  }
  const abs = path.resolve(rootReal, expandTilde(requested))
  const real = await fsp.realpath(abs)
  if (!isInsideRoot(real)) {
    throw new Error('Path is outside the workspace root')
  }
  return real
}

/**
 * Resolve a path for a NEW target (write/create/rename destination) that may not
 * exist yet. Realpaths the nearest existing ancestor, confines THAT to the root, then
 * appends the non-existent trailing segments lexically.
 * @param {string} requested
 * @returns {Promise<string>} the confined absolute path (may not exist yet)
 */
async function resolveForWrite(requested) {
  if (!rootReal) throw new Error('No workspace open')
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new Error('Path must be a non-empty string')
  }
  const abs = path.resolve(rootReal, expandTilde(requested))
  const { existing, rest } = await nearestExistingAncestor(abs)
  const existingReal = await fsp.realpath(existing)
  if (!isInsideRoot(existingReal)) {
    throw new Error('Path is outside the workspace root')
  }
  const candidate = rest.length ? path.join(existingReal, ...rest) : existingReal
  // Final lexical guard on the assembled candidate (defense in depth — the ancestor
  // is already confined and `rest` are plain basenames from the requested path).
  if (!isInsideRoot(candidate) && candidate !== existingReal) {
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
