'use strict'

// IPC filesystem handlers. The renderer never touches `fs` directly — it calls these
// over the typed contextBridge surface (see preload.cjs). Every path goes through the
// workspace-confinement module (workspace.cjs). Inputs are validated defensively
// because the renderer is the less-trusted side once it renders file content.

const { ipcMain, dialog, BrowserWindow, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const ws = require('./workspace.cjs')
const { addRecentFolder } = require('./settings.cjs')

// Set by main.cjs so opening a folder can rebuild the File → Open Recent menu.
let onWorkspaceOpened = null
function setWorkspaceOpenedHandler(fn) { onWorkspaceOpened = fn }

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB text cap (design §7.3 #6)
const MAX_TREE_ENTRIES = 20000 // bound a pathological folder from freezing the UI

// Per-window loose-file allowlist: wcId → Set of realpaths the user opened via the
// "Open File" dialog in THAT window. Only these may be saved back outside the window's
// workspace root — the per-file write gate for detached files, scoped per window so one
// window cannot save into a file another window opened loosely.
const looseFilesByWindow = new Map()
const workspaceWatchersByWindow = new Map()
const workspaceWatchTimersByWindow = new Map()

function looseSet(wcId) {
  let s = looseFilesByWindow.get(wcId)
  if (!s) { s = new Set(); looseFilesByWindow.set(wcId, s) }
  return s
}

// Drop a window's loose-file allowlist (called by main.cjs on window destroy).
function clearLooseFiles(wcId) {
  looseFilesByWindow.delete(wcId)
}

function clearWorkspaceWatch(wcId) {
  const watcher = workspaceWatchersByWindow.get(wcId)
  if (watcher) {
    try { watcher.close() } catch {}
    workspaceWatchersByWindow.delete(wcId)
  }
  const timer = workspaceWatchTimersByWindow.get(wcId)
  if (timer) {
    clearTimeout(timer)
    workspaceWatchTimersByWindow.delete(wcId)
  }
}

function startWorkspaceWatch(wcId, root, webContents) {
  clearWorkspaceWatch(wcId)
  try {
    const watcher = fs.watch(root, { recursive: true }, () => {
      const existing = workspaceWatchTimersByWindow.get(wcId)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        workspaceWatchTimersByWindow.delete(wcId)
        if (!webContents.isDestroyed()) {
          webContents.send('fs:workspace-changed', { root })
        }
      }, 120)
      workspaceWatchTimersByWindow.set(wcId, timer)
    })
    watcher.on('error', () => clearWorkspaceWatch(wcId))
    workspaceWatchersByWindow.set(wcId, watcher)
  } catch {
    // Watching is opportunistic; the tree still loads and manual reload still works.
  }
}

// Read a trusted OS-provided file path as a loose file for a specific window: realpath +
// size-cap it, record it in that window's loose allowlist, and return the payload the
// renderer needs to open a loose tab. The path must come from a TRUSTED source (the OS
// open-file event or native dialog) — never a raw renderer string. Throws on non-file /
// too-large / missing.
async function readLooseFileForWindow(wcId, filePath) {
  const real = await fsp.realpath(filePath)
  const st = await fsp.stat(real)
  if (!st.isFile()) throw new Error('Not a file')
  if (st.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${st.size} bytes, max ${MAX_FILE_SIZE})`)
  }
  const content = await fsp.readFile(real, 'utf8')
  looseSet(wcId).add(real)
  return { path: real, content, mtimeMs: st.mtimeMs, size: st.size }
}

// Directories the tree walk skips (perf + leak-surface). Mirrors khef's ignore set.
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '__pycache__',
  '.next', '.nuxt', 'dist', 'dist-app', '.cache', '.turbo',
  '.parcel-cache', 'coverage', '.vite', 'build', 'target', 'out',
])

function assertString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
}

// Sanitize a renderer-supplied filename LABEL for use as a Save dialog default. Strips any
// path components / NUL, caps length, falls back to "Untitled". Never trusted as a path.
function sanitizeName(suggested) {
  let name = path.basename(String(suggested || '')).replace(/\0/g, '').trim()
  if (name.length > 255) name = name.slice(0, 255)
  return name.length ? name : 'Untitled'
}

// True when `candidate` is lexically under `root` (not the root itself, no `..` escape).
// PURELY lexical (no realpath): a path lexically under the root is routed to the confined
// ws.resolveForWrite, which realpaths and REJECTS symlink escapes. That is why the lexical
// test here must NOT resolve intermediate symlinks — doing so would let `repo/link/evil.txt`
// (link → outside) classify as "outside" and get a silent direct write. Lexically it is
// under root, so it goes to resolveForWrite and fails, per the security review (lissy #1).
function isLexicallyUnder(root, candidate) {
  const rel = path.relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Walk a directory into a nested tree, skipping ignored dirs and never following
 * symlinks out of the workspace (we use withFileTypes and do not recurse into
 * symlinked dirs). Bounded by MAX_TREE_ENTRIES.
 */
async function walkTree(absDir, depth, budget) {
  const dirents = await fsp.readdir(absDir, { withFileTypes: true })
  const entries = []
  for (const d of dirents) {
    if (budget.count >= MAX_TREE_ENTRIES) break
    const childAbs = path.join(absDir, d.name)
    const isDir = d.isDirectory()
    if (isDir && IGNORED_DIRS.has(d.name)) continue
    // Do not descend into symlinks — avoids escaping the root and cycle DoS.
    if (d.isSymbolicLink()) {
      budget.count++
      entries.push({ name: d.name, path: childAbs, type: 'symlink' })
      continue
    }
    budget.count++
    if (isDir) {
      const node = { name: d.name, path: childAbs, type: 'directory', children: undefined }
      if (depth > 0) {
        node.children = await walkTree(childAbs, depth - 1, budget)
      }
      entries.push(node)
    } else if (d.isFile()) {
      entries.push({ name: d.name, path: childAbs, type: 'file' })
    }
  }
  // Directories first, then alphabetical.
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

const MAX_FILE_LIST = 50000 // hard cap on the flat list the fuzzy finder matches against

/**
 * Flat-walk a directory, collecting workspace-relative file paths for the fuzzy
 * finder. Same ignore set + no-symlink-follow + cycle safety as walkTree. Bounded.
 */
async function listFilesFlat(absDir, rootReal, out) {
  if (out.length >= MAX_FILE_LIST) return
  let dirents
  try {
    dirents = await fsp.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of dirents) {
    if (out.length >= MAX_FILE_LIST) return
    if (d.isSymbolicLink()) continue // never follow symlinks out of the root
    const childAbs = path.join(absDir, d.name)
    if (d.isDirectory()) {
      if (IGNORED_DIRS.has(d.name)) continue
      await listFilesFlat(childAbs, rootReal, out)
    } else if (d.isFile()) {
      out.push({ path: childAbs, rel: path.relative(rootReal, childAbs), name: d.name })
    }
  }
}

function registerFsIpc() {
  // Open a folder via native dialog, or accept an explicit path. Sets the workspace
  // root for the CALLING window (keyed by event.sender.id).
  ipcMain.handle('ws:open', async (event, requestedPath) => {
    const wcId = event.sender.id
    let dir = requestedPath
    if (!dir) {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('Window is gone')
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      dir = result.filePaths[0]
    }
    assertString(dir, 'path')
    const root = await ws.setWorkspaceRoot(wcId, dir)
    startWorkspaceWatch(wcId, root, event.sender)
    // Record the realpath'd root as recently-opened and refresh the Open Recent menu.
    await addRecentFolder(root)
    if (onWorkspaceOpened) onWorkspaceOpened()
    return { root }
  })

  // Open a single "loose" file via native dialog WITHOUT changing the workspace root.
  // The path may live anywhere, so this bypasses the workspace seam — but the path can
  // only come from the trusted OS dialog (not the renderer), and we realpath + size-cap
  // it. The realpath is recorded in `looseFiles` so it can later be saved back via
  // `fs:writeLooseFile` and nothing else.
  ipcMain.handle('fs:openLooseFile', async (event) => {
    const wcId = event.sender.id
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('Window is gone')
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return readLooseFileForWindow(wcId, result.filePaths[0])
  })

  // Write back a loose file. Only permitted for a realpath the user actually opened
  // via the loose dialog IN THIS WINDOW — never an arbitrary renderer-supplied path,
  // and never a file another window opened loosely.
  ipcMain.handle('fs:writeLooseFile', async (event, requestedPath, content) => {
    const wcId = event.sender.id
    assertString(requestedPath, 'path')
    if (typeof content !== 'string') throw new Error('content must be a string')
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
      throw new Error('Content exceeds max file size')
    }
    // The tab carries the realpath we returned from openLooseFile. Re-realpath to be
    // safe against symlink swaps, then require an exact allowlist match for this window.
    const real = await fsp.realpath(path.resolve(requestedPath))
    if (!looseSet(wcId).has(real)) {
      throw new Error('File was not opened via Open File')
    }
    await fsp.writeFile(real, content, 'utf8')
    const st = await fsp.stat(real)
    return { path: real, mtimeMs: st.mtimeMs, size: st.size }
  })

  // Re-read a loose file from disk (reload/revert). Same trust gate as fs:writeLooseFile:
  // only a realpath the user opened via the loose dialog or OS open-file IN THIS WINDOW.
  ipcMain.handle('fs:readLoose', async (event, requestedPath) => {
    const wcId = event.sender.id
    assertString(requestedPath, 'path')
    const real = await fsp.realpath(path.resolve(requestedPath))
    if (!looseSet(wcId).has(real)) {
      throw new Error('File was not opened via Open File')
    }
    const st = await fsp.stat(real)
    if (!st.isFile()) throw new Error('Not a file')
    if (st.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${st.size} bytes, max ${MAX_FILE_SIZE})`)
    }
    const content = await fsp.readFile(real, 'utf8')
    return { path: real, content, mtimeMs: st.mtimeMs, size: st.size }
  })

  // Save an untitled buffer to a user-chosen location. The renderer NEVER supplies the
  // final path — main opens the native Save dialog and decides how to write based on where
  // the user picks:
  //   - lexically UNDER this window's workspace root → must succeed via the confined
  //     resolveForWrite (which realpaths and rejects symlink escapes). If it rejects, the
  //     save FAILS — we never fall back to a direct write (that would let an in-repo symlink
  //     escape the root).
  //   - NOT under the root (or no workspace open) → write directly and record the
  //     post-write realpath in this window's loose allowlist, so later saves go through
  //     fs:writeLooseFile.
  ipcMain.handle('fs:saveAs', async (event, content, suggestedName) => {
    const wcId = event.sender.id
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('Window is gone')
    if (typeof content !== 'string') throw new Error('content must be a string')
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
      throw new Error('Content exceeds max file size')
    }
    const safeName = sanitizeName(suggestedName)
    const root = ws.getWorkspaceRoot(wcId)
    const defaultPath = root ? path.join(root, safeName) : path.join(os.homedir(), safeName)

    const result = await dialog.showSaveDialog(win, { defaultPath })
    if (result.canceled || !result.filePath) return null
    const selected = result.filePath

    if (root && isLexicallyUnder(root, selected)) {
      // Under the workspace lexically → MUST go through the confined write. resolveForWrite
      // realpaths the nearest existing ancestor and rejects anything resolving outside; if
      // it throws we let it propagate (save fails), never writing outside.
      const target = await ws.resolveForWrite(wcId, selected)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, content, 'utf8')
      const st = await fsp.stat(target)
      return { path: target, name: path.basename(target), mtimeMs: st.mtimeMs, size: st.size, loose: false }
    }

    // Outside the root (or no workspace) → direct write, then allowlist the realpath so
    // subsequent saves use the loose-write gate.
    await fsp.mkdir(path.dirname(selected), { recursive: true })
    await fsp.writeFile(selected, content, 'utf8')
    const real = await fsp.realpath(selected)
    looseSet(wcId).add(real)
    const st = await fsp.stat(real)
    return { path: real, name: path.basename(real), mtimeMs: st.mtimeMs, size: st.size, loose: true }
  })

  ipcMain.handle('ws:current', async (event) => {
    return { root: ws.getWorkspaceRoot(event.sender.id) }
  })

  // Reveal a file in Finder. Read-level trust: the path must resolve inside this window's
  // workspace root (same confinement as fs:read), or be on this window's loose-file
  // allowlist (a file the user opened via the dialog / Finder). Anything else is rejected —
  // the renderer must never be able to probe arbitrary disk paths through Finder.
  ipcMain.handle('fs:reveal', async (event, requestedPath) => {
    const wcId = event.sender.id
    assertString(requestedPath, 'path')
    let real
    try {
      real = await ws.resolveExisting(wcId, requestedPath)
    } catch (err) {
      // Not under the workspace root — allow only an exact loose-allowlist match.
      const candidate = await fsp.realpath(path.resolve(requestedPath))
      if (!looseSet(wcId).has(candidate)) throw err
      real = candidate
    }
    shell.showItemInFolder(real)
    return { path: real }
  })

  // Read a file's text content (UTF-8). Confined to the calling window's root + size-capped.
  ipcMain.handle('fs:read', async (event, requestedPath) => {
    assertString(requestedPath, 'path')
    const real = await ws.resolveExisting(event.sender.id, requestedPath)
    const st = await fsp.stat(real)
    if (!st.isFile()) throw new Error('Not a file')
    if (st.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${st.size} bytes, max ${MAX_FILE_SIZE})`)
    }
    const content = await fsp.readFile(real, 'utf8')
    return { path: real, content, mtimeMs: st.mtimeMs, size: st.size }
  })

  // Write text to a file (creates if needed). Uses write-resolution for new targets.
  ipcMain.handle('fs:write', async (event, requestedPath, content) => {
    assertString(requestedPath, 'path')
    if (typeof content !== 'string') throw new Error('content must be a string')
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
      throw new Error('Content exceeds max file size')
    }
    const target = await ws.resolveForWrite(event.sender.id, requestedPath)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, content, 'utf8')
    const st = await fsp.stat(target)
    return { path: target, mtimeMs: st.mtimeMs, size: st.size }
  })

  // List a directory tree to a bounded depth.
  ipcMain.handle('fs:tree', async (event, requestedPath, depth) => {
    const wcId = event.sender.id
    const root = ws.getWorkspaceRoot(wcId)
    const startReq = requestedPath || root
    if (!startReq) throw new Error('No workspace open')
    const real = await ws.resolveExisting(wcId, startReq)
    const st = await fsp.stat(real)
    if (!st.isDirectory()) throw new Error('Not a directory')
    const d = Number.isInteger(depth) ? Math.max(0, Math.min(depth, 32)) : 8
    const budget = { count: 0 }
    const entries = await walkTree(real, d, budget)
    return { path: real, entries, truncated: budget.count >= MAX_TREE_ENTRIES }
  })

  // Flat list of all files under the window's workspace root, for the Cmd+P fuzzy finder.
  ipcMain.handle('fs:listFiles', async (event) => {
    const root = ws.getWorkspaceRoot(event.sender.id)
    if (!root) throw new Error('No workspace open')
    const out = []
    await listFilesFlat(root, root, out)
    return { files: out, truncated: out.length >= MAX_FILE_LIST }
  })

  // Delete a file or empty/recursive directory. Confined to the window's root.
  ipcMain.handle('fs:delete', async (event, requestedPath) => {
    const wcId = event.sender.id
    assertString(requestedPath, 'path')
    const real = await ws.resolveExisting(wcId, requestedPath)
    if (real === ws.getWorkspaceRoot(wcId)) {
      throw new Error('Refusing to delete the workspace root')
    }
    await fsp.rm(real, { recursive: true, force: false })
    return { path: real, deleted: true }
  })
}

module.exports = { registerFsIpc, setWorkspaceOpenedHandler, clearLooseFiles, clearWorkspaceWatch, readLooseFileForWindow, MAX_FILE_SIZE, IGNORED_DIRS }
