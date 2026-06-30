'use strict'

// IPC filesystem handlers. The renderer never touches `fs` directly — it calls these
// over the typed contextBridge surface (see preload.cjs). Every path goes through the
// workspace-confinement module (workspace.cjs). Inputs are validated defensively
// because the renderer is the less-trusted side once it renders file content.

const { ipcMain, dialog, BrowserWindow } = require('electron')
const fsp = require('node:fs/promises')
const path = require('node:path')
const ws = require('./workspace.cjs')
const { addRecentFolder } = require('./settings.cjs')

// Set by main.cjs so opening a folder can rebuild the File → Open Recent menu.
let onWorkspaceOpened = null
function setWorkspaceOpenedHandler(fn) { onWorkspaceOpened = fn }

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB text cap (design §7.3 #6)
const MAX_TREE_ENTRIES = 20000 // bound a pathological folder from freezing the UI

// Realpaths the user opened via the loose "Open File" dialog. Only these may be saved
// back outside the workspace root — the per-file write gate for detached files.
const looseFiles = new Set()

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
  // Open a folder via native dialog, or accept an explicit path. Sets the workspace root.
  ipcMain.handle('ws:open', async (event, requestedPath) => {
    let dir = requestedPath
    if (!dir) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      dir = result.filePaths[0]
    }
    assertString(dir, 'path')
    const root = await ws.setWorkspaceRoot(dir)
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
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const real = await fsp.realpath(result.filePaths[0])
    const st = await fsp.stat(real)
    if (!st.isFile()) throw new Error('Not a file')
    if (st.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${st.size} bytes, max ${MAX_FILE_SIZE})`)
    }
    const content = await fsp.readFile(real, 'utf8')
    looseFiles.add(real)
    return { path: real, content, mtimeMs: st.mtimeMs, size: st.size }
  })

  // Write back a loose file. Only permitted for a realpath the user actually opened
  // via the loose dialog this session — never an arbitrary renderer-supplied path.
  ipcMain.handle('fs:writeLooseFile', async (_event, requestedPath, content) => {
    assertString(requestedPath, 'path')
    if (typeof content !== 'string') throw new Error('content must be a string')
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
      throw new Error('Content exceeds max file size')
    }
    // The tab carries the realpath we returned from openLooseFile. Re-realpath to be
    // safe against symlink swaps, then require an exact allowlist match.
    const real = await fsp.realpath(path.resolve(requestedPath))
    if (!looseFiles.has(real)) {
      throw new Error('File was not opened via Open File')
    }
    await fsp.writeFile(real, content, 'utf8')
    const st = await fsp.stat(real)
    return { path: real, mtimeMs: st.mtimeMs, size: st.size }
  })

  ipcMain.handle('ws:current', async () => {
    return { root: ws.getWorkspaceRoot() }
  })

  // Read a file's text content (UTF-8). Confined + size-capped.
  ipcMain.handle('fs:read', async (_event, requestedPath) => {
    assertString(requestedPath, 'path')
    const real = await ws.resolveExisting(requestedPath)
    const st = await fsp.stat(real)
    if (!st.isFile()) throw new Error('Not a file')
    if (st.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${st.size} bytes, max ${MAX_FILE_SIZE})`)
    }
    const content = await fsp.readFile(real, 'utf8')
    return { path: real, content, mtimeMs: st.mtimeMs, size: st.size }
  })

  // Write text to a file (creates if needed). Uses write-resolution for new targets.
  ipcMain.handle('fs:write', async (_event, requestedPath, content) => {
    assertString(requestedPath, 'path')
    if (typeof content !== 'string') throw new Error('content must be a string')
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
      throw new Error('Content exceeds max file size')
    }
    const target = await ws.resolveForWrite(requestedPath)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, content, 'utf8')
    const st = await fsp.stat(target)
    return { path: target, mtimeMs: st.mtimeMs, size: st.size }
  })

  // List a directory tree to a bounded depth.
  ipcMain.handle('fs:tree', async (_event, requestedPath, depth) => {
    const root = ws.getWorkspaceRoot()
    const startReq = requestedPath || root
    if (!startReq) throw new Error('No workspace open')
    const real = await ws.resolveExisting(startReq)
    const st = await fsp.stat(real)
    if (!st.isDirectory()) throw new Error('Not a directory')
    const d = Number.isInteger(depth) ? Math.max(0, Math.min(depth, 32)) : 8
    const budget = { count: 0 }
    const entries = await walkTree(real, d, budget)
    return { path: real, entries, truncated: budget.count >= MAX_TREE_ENTRIES }
  })

  // Flat list of all files under the workspace root, for the Cmd+P fuzzy finder.
  ipcMain.handle('fs:listFiles', async () => {
    const root = ws.getWorkspaceRoot()
    if (!root) throw new Error('No workspace open')
    const out = []
    await listFilesFlat(root, root, out)
    return { files: out, truncated: out.length >= MAX_FILE_LIST }
  })

  // Delete a file or empty/recursive directory. Confined to the root.
  ipcMain.handle('fs:delete', async (_event, requestedPath) => {
    assertString(requestedPath, 'path')
    const real = await ws.resolveExisting(requestedPath)
    if (real === ws.getWorkspaceRoot()) {
      throw new Error('Refusing to delete the workspace root')
    }
    await fsp.rm(real, { recursive: true, force: false })
    return { path: real, deleted: true }
  })
}

module.exports = { registerFsIpc, setWorkspaceOpenedHandler, MAX_FILE_SIZE, IGNORED_DIRS }
