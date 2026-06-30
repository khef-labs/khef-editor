'use strict'

// Tiny JSON settings store in the app's userData dir (Electron's standard per-app
// location). Self-contained — no khef dependency. Foundation for theme, and later
// recent-folders / window-state.

const { app, ipcMain } = require('electron')
const fsp = require('node:fs/promises')
const path = require('node:path')

const DEFAULTS = {
  theme: 'dark-plus',
  sidebarWidth: 300,
  recentFolders: [], // most-recent-first list of opened workspace roots
}

const MAX_RECENT = 12

let cache = null
let filePath = null

function settingsPath() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'settings.json')
  return filePath
}

async function load() {
  if (cache) return cache
  try {
    const raw = await fsp.readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    cache = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

async function save(patch) {
  const current = await load()
  cache = { ...current, ...patch }
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true })
  await fsp.writeFile(settingsPath(), JSON.stringify(cache, null, 2), 'utf8')
  return cache
}

async function getRecentFolders() {
  const s = await load()
  const list = Array.isArray(s.recentFolders) ? s.recentFolders : []
  return list.filter((p) => typeof p === 'string')
}

// Record a folder as most-recently-opened. Dedupes, moves to front, caps the list.
async function addRecentFolder(dir) {
  if (typeof dir !== 'string' || !dir) return getRecentFolders()
  const list = await getRecentFolders()
  const next = [dir, ...list.filter((p) => p !== dir)].slice(0, MAX_RECENT)
  await save({ recentFolders: next })
  return next
}

let onRecentChange = null
function setRecentChangeHandler(fn) { onRecentChange = fn }

function registerSettingsIpc() {
  ipcMain.handle('settings:get', async () => load())
  ipcMain.handle('settings:set', async (_event, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('patch must be an object')
    // Only allow known keys to be written.
    const allowed = {}
    for (const k of Object.keys(DEFAULTS)) {
      if (k in patch) allowed[k] = patch[k]
    }
    return save(allowed)
  })
  ipcMain.handle('recent:get', async () => getRecentFolders())
  ipcMain.handle('recent:clear', async () => {
    await save({ recentFolders: [] })
    if (onRecentChange) onRecentChange()
    return []
  })
}

module.exports = { registerSettingsIpc, DEFAULTS, getRecentFolders, addRecentFolder, setRecentChangeHandler }
