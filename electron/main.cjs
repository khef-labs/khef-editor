'use strict'

// Khef Editor — Electron main process.
// Owns the window, the app menu, and ALL filesystem access (via fs-ipc.cjs). The
// renderer is sandboxed and reaches disk only through the typed contextBridge surface.
// Renderer hardening here is the highest-priority security control (design §7.3 #1).

const { app, BrowserWindow, Menu, session, shell } = require('electron')
const path = require('node:path')
const os = require('node:os')
const { registerFsIpc, setWorkspaceOpenedHandler, clearLooseFiles, readLooseFileForWindow } = require('./fs-ipc.cjs')
const { registerSettingsIpc, getRecentFolders, setRecentChangeHandler } = require('./settings.cjs')
const { registerSearchIpc } = require('./search.cjs')
const { registerGitIpc } = require('./git.cjs')
const ws = require('./workspace.cjs')

const isDev = process.env.KHEF_EDITOR_DEV === '1'
const DEV_URL = 'http://localhost:5273'

app.setName('Khef Editor')

let isQuitting = false // true only during an explicit app quit (Cmd+Q / menu Quit)

// Create a new editor window. Each window is an independent workspace: its fs/search/git
// IPC is confined to whatever folder IT opens, keyed by webContents.id. Returns the window.
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'Khef Editor',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      // Security posture (design §7.3 #1):
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Capture this window's webContents id once, at creation. All per-window state
  // (workspace root, loose-file allowlist) is keyed by this id, and cleanup on destroy
  // clears exactly this id — never a focused-window lookup, which could race.
  const wcId = win.webContents.id

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Close policy (D1): with more than one window open, a close request (red traffic-light
  // button / Shift+Cmd+W) DESTROYS that window. The LAST remaining window instead HIDES,
  // so the app never vanishes by accident — only Cmd+Q quits. Cmd+W is handled in the
  // renderer and only closes tabs.
  win.on('close', (event) => {
    if (isQuitting) return // explicit quit → let every window close
    const isLast = BrowserWindow.getAllWindows().length <= 1
    if (isLast) {
      event.preventDefault()
      win.hide()
    }
    // else: allow the close → 'closed' fires below and frees this window's state.
  })

  win.on('closed', () => {
    // Free this window's per-window state so the maps don't leak as windows come and go.
    // Only reached on real destroy (not the hide path above).
    ws.clearWorkspaceRoot(wcId)
    clearLooseFiles(wcId)
  })

  return win
}

// The window a menu command should act on: the focused window, captured at click time.
function focusedWin() {
  return BrowserWindow.getFocusedWindow()
}

// Send a menu event to the focused window's renderer. Captured once at call time — never
// re-queried after async work (the event sender is the authority for fs identity; menu
// focus only picks which renderer receives the event).
function sendToFocused(channel, ...args) {
  const { win, fresh } = targetWindow()
  if (fresh) {
    // A brand-new window's renderer hasn't subscribed to menu events yet; wait until it
    // finishes loading before sending, or the message is lost.
    win.webContents.once('did-finish-load', () => win.webContents.send(channel, ...args))
  } else {
    win.webContents.send(channel, ...args)
  }
}

// --- Finder "Open With" / file-association handling ---
// When a file is double-clicked in Finder (or `open -a "Khef Editor" file.md`), macOS
// sends app.on('open-file'). On a COLD launch this fires BEFORE app is ready, so we buffer
// paths until the app + a window are ready, then open them. Files opened this way live
// anywhere on disk, so they go through the LOOSE-file path (read in main, pushed to the
// renderer as a detached tab) — never the workspace-confined read.
let appReady = false
const pendingOpenFiles = []

// Read `filePath` as a loose file for a target window and push it to that renderer. Picks
// the focused/visible window (revealing a hidden one), creating one if none exist.
async function openOsFile(filePath) {
  const { win, fresh } = targetWindow()
  const wcId = win.webContents.id
  try {
    const payload = await readLooseFileForWindow(wcId, filePath)
    const send = () => win.webContents.send('menu:open-loose', payload)
    if (fresh || win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', send)
    } else {
      send()
    }
    win.show()
    win.focus()
  } catch {
    // Non-file, too large, or unreadable — silently ignore (matches the loose-file dialog).
  }
}

// Queue a path if the app/window isn't ready yet, else open it now.
function handleOpenFile(filePath) {
  if (!appReady) { pendingOpenFiles.push(filePath); return }
  void openOsFile(filePath)
}

// Register at top level so a cold-launch open-file (fired before whenReady) is captured.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  handleOpenFile(filePath)
})

// Resolve the window a menu command should act on. Menu items stay enabled even when the
// only window is HIDDEN (the last-window-hidden case from the D1 close policy), so we must
// always return a real, visible window — otherwise commands like Open Recent silently
// no-op. Preference: focused → any visible → reveal a hidden one → create a new one.
// Returns { win, fresh } where `fresh` means the window was just created (renderer not
// loaded yet) so callers must defer any send until it finishes loading.
function targetWindow() {
  const focused = focusedWin()
  if (focused) return { win: focused, fresh: false }
  const wins = BrowserWindow.getAllWindows()
  const visible = wins.find((w) => w.isVisible())
  if (visible) { visible.focus(); return { win: visible, fresh: false } }
  const hidden = wins[0]
  if (hidden) { hidden.show(); hidden.focus(); return { win: hidden, fresh: false } }
  return { win: createWindow(), fresh: true }
}

// Block the renderer from navigating away or opening arbitrary URLs/external schemes.
function installNavigationGuards() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const ok = isDev && url.startsWith(DEV_URL)
      if (!ok) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      // Allow opening http(s) links in the user's real browser; deny everything else.
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url)
      }
      return { action: 'deny' }
    })
  })
}

// Strict Content-Security-Policy on the renderer document. No remote script, no eval,
// no remote connections. All assets are bundled local files. In dev, Vite needs inline
// styles and a websocket to localhost for HMR, so the policy is loosened minimally.
function installCsp() {
  const prodCsp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

  const devCsp = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${DEV_URL} ws://localhost:5273`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? devCsp : prodCsp],
      },
    })
  })
}

function buildMenu(recentFolders = []) {
  const recentSubmenu = recentFolders.length
    ? [
        ...recentFolders.map((dir) => ({
          label: dir.replace(os.homedir(), '~'),
          click: () => sendToFocused('menu:open-recent', dir),
        })),
        { type: 'separator' },
        { label: 'Clear Recently Opened', click: () => sendToFocused('menu:clear-recent') },
      ]
    : [{ label: 'No Recent Folders', enabled: false }]

  const template = [
    {
      label: 'Khef Editor',
      submenu: [
        { role: 'about' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToFocused('menu:settings'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToFocused('menu:new-file'),
        },
        {
          label: 'New Window',
          accelerator: 'Shift+CmdOrCtrl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToFocused('menu:open-file'),
        },
        {
          label: 'Open Folder…',
          accelerator: 'Shift+CmdOrCtrl+O',
          click: () => sendToFocused('menu:open-folder'),
        },
        { label: 'Open Recent', submenu: recentSubmenu },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToFocused('menu:save'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendToFocused('menu:close-tab'),
        },
        {
          label: 'Close Window',
          accelerator: 'Shift+CmdOrCtrl+W',
          click: () => focusedWin()?.close(),
        },
        { type: 'separator' },
        {
          label: 'Split Editor',
          accelerator: 'CmdOrCtrl+\\',
          click: () => sendToFocused('menu:split'),
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Quick Open…',
          accelerator: 'Cmd+P', // Cmd only — Ctrl+P is the editor's Emacs cursor-up
          click: () => sendToFocused('menu:quick-open'),
        },
        {
          label: 'Open Preview to the Side',
          accelerator: 'Shift+CmdOrCtrl+V',
          click: () => sendToFocused('menu:preview-side'),
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendToFocused('menu:toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' },
        // No "Close" role here — Cmd+W is reserved for closing tabs. Closing a WINDOW is
        // File → Close Window (Shift+Cmd+W); the last window hides rather than closing.
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Rebuild the menu with the current Open Recent list.
async function refreshMenu() {
  try { buildMenu(await getRecentFolders()) } catch { buildMenu([]) }
}

app.whenReady().then(() => {
  installNavigationGuards()
  installCsp()
  registerFsIpc()
  registerSettingsIpc()
  registerSearchIpc()
  registerGitIpc()
  // Rebuild the Open Recent submenu whenever a folder opens or the list is cleared.
  setWorkspaceOpenedHandler(() => void refreshMenu())
  setRecentChangeHandler(() => void refreshMenu())
  void refreshMenu()
  createWindow()

  // App + first window are up: drain any files Finder asked us to open during cold launch.
  appReady = true
  if (pendingOpenFiles.length) {
    const files = pendingOpenFiles.splice(0)
    for (const f of files) void openOsFile(f)
  }

  app.on('activate', () => {
    // Dock-icon click: if every window is hidden (the last-window-hidden case), re-show
    // them; if there are none at all, create one.
    const wins = BrowserWindow.getAllWindows()
    if (wins.length === 0) {
      createWindow()
    } else {
      for (const w of wins) if (!w.isVisible()) w.show()
    }
  })
})

// Mark an explicit quit so the window 'close' guard lets it through.
app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // On macOS, apps normally stay alive when all windows close. We also keep the
  // window alive (hidden) via the close guard, so this rarely fires — but keep the
  // platform-conventional quit for non-macOS.
  if (process.platform !== 'darwin') app.quit()
})
