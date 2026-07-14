'use strict'

// Preload — the ONLY bridge between the sandboxed renderer and the main process.
// Exposes a minimal, explicit, typed surface as `window.editorApi`. Never exposes
// ipcRenderer, fs, child_process, or any general-purpose capability (design §7.3 #1).

const { contextBridge, ipcRenderer } = require('electron')

// Whitelisted menu events the renderer may subscribe to. Anything not listed is
// unreachable from the renderer.
const MENU_CHANNELS = new Set(['menu:open-folder', 'menu:open-file', 'menu:new-file', 'menu:save', 'menu:quick-open', 'menu:settings', 'menu:close-tab', 'menu:split', 'menu:toggle-sidebar', 'menu:preview-side', 'menu:open-recent', 'menu:clear-recent', 'menu:open-loose'])

contextBridge.exposeInMainWorld('editorApi', {
  // Workspace
  openWorkspace: (dirPath) => ipcRenderer.invoke('ws:open', dirPath ?? null),
  openLooseFile: () => ipcRenderer.invoke('fs:openLooseFile'),
  currentWorkspace: () => ipcRenderer.invoke('ws:current'),

  // Filesystem (all confined to the open workspace root in the main process)
  readFile: (filePath) => ipcRenderer.invoke('fs:read', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:write', filePath, content),
  writeLooseFile: (filePath, content) => ipcRenderer.invoke('fs:writeLooseFile', filePath, content),
  readLooseFile: (filePath) => ipcRenderer.invoke('fs:readLoose', filePath),
  saveAs: (content, suggestedName) => ipcRenderer.invoke('fs:saveAs', content, suggestedName),
  tree: (dirPath, depth) => ipcRenderer.invoke('fs:tree', dirPath ?? null, depth ?? 8),
  listFiles: () => ipcRenderer.invoke('fs:listFiles'),
  search: (query, options) => ipcRenderer.invoke('fs:search', query, options ?? {}),
  replaceAll: (query, replacement, options) => ipcRenderer.invoke('fs:replaceAll', query, replacement, options ?? {}),
  deletePath: (targetPath) => ipcRenderer.invoke('fs:delete', targetPath),
  revealInFinder: (filePath) => ipcRenderer.invoke('fs:reveal', filePath),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // Git (read-only)
  git: {
    info: () => ipcRenderer.invoke('git:info'),
    status: () => ipcRenderer.invoke('git:status'),
    log: (skip, limit) => ipcRenderer.invoke('git:log', skip ?? 0, limit ?? 50),
    commitFiles: (hash) => ipcRenderer.invoke('git:commitFiles', hash),
    fileDiff: (args) => ipcRenderer.invoke('git:fileDiff', args),
  },

  // Recent folders
  recentFolders: () => ipcRenderer.invoke('recent:get'),
  clearRecentFolders: () => ipcRenderer.invoke('recent:clear'),

  // Menu events (main → renderer). Returns an unsubscribe function. The handler receives
  // any extra arg the main process sent (e.g. the path for menu:open-recent).
  onMenu: (channel, handler) => {
    if (!MENU_CHANNELS.has(channel)) {
      throw new Error(`Unknown menu channel: ${channel}`)
    }
    const listener = (_event, ...args) => handler(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
