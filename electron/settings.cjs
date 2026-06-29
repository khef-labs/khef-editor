'use strict'

// Tiny JSON settings store in the app's userData dir (Electron's standard per-app
// location). Self-contained — no khef dependency. Foundation for theme, and later
// recent-folders / window-state.

const { app, ipcMain } = require('electron')
const fsp = require('node:fs/promises')
const path = require('node:path')

const DEFAULTS = {
  theme: 'dark-plus',
}

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
}

module.exports = { registerSettingsIpc, DEFAULTS }
