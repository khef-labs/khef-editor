'use strict'

// Khef Editor — Electron main process.
// Owns the window, the app menu, and ALL filesystem access (via fs-ipc.cjs). The
// renderer is sandboxed and reaches disk only through the typed contextBridge surface.
// Renderer hardening here is the highest-priority security control (design §7.3 #1).

const { app, BrowserWindow, Menu, session, shell } = require('electron')
const path = require('node:path')
const { registerFsIpc } = require('./fs-ipc.cjs')
const { registerSettingsIpc } = require('./settings.cjs')
const { registerSearchIpc } = require('./search.cjs')
const { registerGitIpc } = require('./git.cjs')

const isDev = process.env.KHEF_EDITOR_DEV === '1'
const DEV_URL = 'http://localhost:5273'

app.setName('Khef Editor')

let mainWindow = null
let isQuitting = false // true only during an explicit app quit (Cmd+Q / menu Quit)

function createWindow() {
  mainWindow = new BrowserWindow({
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

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Never let the window close unless the user is explicitly quitting (Cmd+Q). Any
  // other close attempt (red traffic-light button, stray shortcut) hides the window
  // instead of destroying it, so the app stays alive. Cmd+W is handled separately in
  // the renderer and only closes tabs.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
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

function buildMenu() {
  const template = [
    {
      label: 'Khef Editor',
      submenu: [
        { role: 'about' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings'),
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
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-file'),
        },
        {
          label: 'Open Folder…',
          accelerator: 'Shift+CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-folder'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:close-tab'),
        },
        { type: 'separator' },
        {
          label: 'Split Editor',
          accelerator: 'CmdOrCtrl+\\',
          click: () => mainWindow?.webContents.send('menu:split'),
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
          click: () => mainWindow?.webContents.send('menu:quick-open'),
        },
        {
          label: 'Open Preview to the Side',
          accelerator: 'Shift+CmdOrCtrl+V',
          click: () => mainWindow?.webContents.send('menu:preview-side'),
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
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
        // Intentionally NO "Close" item — Cmd+W is reserved for closing tabs only,
        // and the window/app must never close via Cmd+W.
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  installNavigationGuards()
  installCsp()
  registerFsIpc()
  registerSettingsIpc()
  registerSearchIpc()
  registerGitIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    // Re-show the hidden window (or recreate it) when the dock icon is clicked.
    if (mainWindow) mainWindow.show()
    else if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
