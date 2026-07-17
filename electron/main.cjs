'use strict'

// Khef Editor — Electron main process.
// Owns the window, the app menu, and ALL filesystem access (via fs-ipc.cjs). The
// renderer is sandboxed and reaches disk only through the typed contextBridge surface.
// Renderer hardening here is the highest-priority security control (design §7.3 #1).

const { app, BrowserWindow, Menu, session, shell } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fsp = require('node:fs/promises')
const { registerFsIpc, setWorkspaceOpenedHandler, clearLooseFiles, clearWorkspaceWatch, readLooseFileForWindow } = require('./fs-ipc.cjs')
const { registerSettingsIpc, getRecentFolders, setRecentChangeHandler } = require('./settings.cjs')
const { registerSearchIpc } = require('./search.cjs')
const { registerGitIpc } = require('./git.cjs')
const ws = require('./workspace.cjs')

const isDev = process.env.KHEF_EDITOR_DEV === '1'
const DEV_URL = 'http://localhost:5273'

app.setName('Khef Editor')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

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
    clearWorkspaceWatch(wcId)
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

// --- Shell/Finder/deep-link launch handling ---
// Supported launch forms:
//   open -a "Khef Editor" file.md
//   open -a "Khef Editor" --args .                  (cold launch / direct Electron launch)
//   open -n -a "Khef Editor" --args --new-window .
//   open -a "Khef Editor" --args --goto src/App.tsx:42
//   open "khef-editor://open?path=/abs/file.ts&line=42&newWindow=1"
// Use the custom protocol for shell helpers that must target an already-running app;
// macOS Launch Services does not reliably deliver new --args to a running app.
//
// Files opened this way live anywhere on disk, so they go through the LOOSE-file path
// (read in main, pushed to the renderer as a detached tab) — never the
// workspace-confined read. Directories are forwarded to the renderer as workspace-open
// requests.
let appReady = false
const pendingLaunchRequests = []

function expandHome(input) {
  if (input === '~') return os.homedir()
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2))
  return input
}

function splitPathAndLine(input) {
  const match = /^(.*):([0-9]+)(?::[0-9]+)?$/.exec(input)
  if (!match || !match[1]) return { targetPath: input }
  const line = Number.parseInt(match[2], 10)
  return { targetPath: match[1], line: Number.isFinite(line) && line > 0 ? line : undefined }
}

function launchRequestFromTarget(rawTarget, cwd, lineOverride, options = {}) {
  if (typeof rawTarget !== 'string' || rawTarget.length === 0) return null
  const { targetPath, line } = splitPathAndLine(rawTarget)
  const resolvedPath = path.resolve(cwd || process.cwd(), expandHome(targetPath))
  return { path: resolvedPath, line: lineOverride || line, newWindow: !!options.newWindow }
}

function isDevAppPath(arg, cwd) {
  if (!isDev) return false
  if (arg === '.') return true
  const resolved = path.resolve(cwd || process.cwd(), arg)
  return resolved === path.resolve(__dirname, '..')
}

function parseLaunchArgs(argv, cwd = process.cwd()) {
  const requests = []
  const args = Array.isArray(argv) ? argv.slice(1) : []
  if (args.length && isDevAppPath(args[0], cwd)) args.shift()

  let positionalMode = false
  let pendingLine = null
  let pendingNewWindow = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg || arg.startsWith('-psn_')) continue

    if (!positionalMode && arg === '--') {
      positionalMode = true
      continue
    }
    if (!positionalMode && arg === '--new-window') {
      pendingNewWindow = true
      continue
    }
    if (!positionalMode && arg === '--reuse-window') {
      pendingNewWindow = false
      continue
    }
    if (!positionalMode && (arg === '--goto' || arg === '-g')) {
      const target = args[++i]
      const request = launchRequestFromTarget(target, cwd, pendingLine || undefined, { newWindow: pendingNewWindow })
      if (request) requests.push(request)
      pendingLine = null
      pendingNewWindow = false
      continue
    }
    if (!positionalMode && arg.startsWith('--goto=')) {
      const request = launchRequestFromTarget(arg.slice('--goto='.length), cwd, pendingLine || undefined, { newWindow: pendingNewWindow })
      if (request) requests.push(request)
      pendingLine = null
      pendingNewWindow = false
      continue
    }
    if (!positionalMode && (arg === '--line' || arg === '-l')) {
      const parsed = Number.parseInt(args[++i] || '', 10)
      pendingLine = Number.isFinite(parsed) && parsed > 0 ? parsed : null
      continue
    }
    if (!positionalMode && arg.startsWith('--line=')) {
      const parsed = Number.parseInt(arg.slice('--line='.length), 10)
      pendingLine = Number.isFinite(parsed) && parsed > 0 ? parsed : null
      continue
    }
    if (!positionalMode && arg.startsWith('khef-editor://')) {
      const request = parseLaunchUrl(arg)
      if (request) requests.push(request)
      continue
    }
    if (!positionalMode && arg.startsWith('-')) continue

    const request = launchRequestFromTarget(arg, cwd, pendingLine || undefined, { newWindow: pendingNewWindow })
    if (request) requests.push(request)
    pendingLine = null
    pendingNewWindow = false
  }
  return requests
}

function parseLaunchUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'khef-editor:') return null
    const rawPath = parsed.searchParams.get('path') || parsed.searchParams.get('file') || parsed.searchParams.get('root')
    if (!rawPath) return null
    const parsedLine = Number.parseInt(parsed.searchParams.get('line') || '', 10)
    const newWindow = ['1', 'true', 'yes'].includes((parsed.searchParams.get('newWindow') || '').toLowerCase())
    return launchRequestFromTarget(
      rawPath,
      process.cwd(),
      Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : undefined,
      { newWindow },
    )
  } catch {
    return null
  }
}

function sendLaunchRequest(win, fresh, request) {
  const send = () => win.webContents.send('menu:open-launch', request)
  if (fresh || win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
  win.show()
  win.focus()
}

// Resolve a launch target, then push either a workspace-open or loose-file-open request to
// the focused/visible window (revealing a hidden one), creating one if none exist.
async function openLaunchRequest(request) {
  const { win, fresh } = targetWindow({ forceNew: request.newWindow })
  const wcId = win.webContents.id
  try {
    const real = await fsp.realpath(request.path)
    const st = await fsp.stat(real)
    if (st.isDirectory()) {
      sendLaunchRequest(win, fresh, { kind: 'workspace', path: real })
      return
    }
    if (!st.isFile()) return
    const file = await readLooseFileForWindow(wcId, real)
    sendLaunchRequest(win, fresh, { kind: 'file', file, line: request.line })
  } catch {
    // Missing, too large, unreadable, or unsupported — silently ignore (matches open dialog).
  }
}

// Queue a path if the app/window isn't ready yet, else open it now.
function handleLaunchRequest(request) {
  if (!request) return
  if (!appReady) { pendingLaunchRequests.push(request); return }
  void openLaunchRequest(request)
}

// Register at top level so a cold-launch open-file (fired before whenReady) is captured.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  handleLaunchRequest(launchRequestFromTarget(filePath, process.cwd()))
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleLaunchRequest(parseLaunchUrl(url))
})

app.on('second-instance', (_event, commandLine, workingDirectory) => {
  const requests = parseLaunchArgs(commandLine, workingDirectory)
  if (requests.length) {
    for (const request of requests) handleLaunchRequest(request)
    return
  }
  const { win } = targetWindow()
  win.show()
  win.focus()
})

// Resolve the window a menu command should act on. Menu items stay enabled even when the
// only window is HIDDEN (the last-window-hidden case from the D1 close policy), so we must
// always return a real, visible window — otherwise commands like Open Recent silently
// no-op. Preference: focused → any visible → reveal a hidden one → create a new one.
// Returns { win, fresh } where `fresh` means the window was just created (renderer not
// loaded yet) so callers must defer any send until it finishes loading.
function targetWindow(options = {}) {
  if (options.forceNew) return { win: createWindow(), fresh: true }
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
  if (!hasSingleInstanceLock) return
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('khef-editor', process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('khef-editor')
  }

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

  for (const request of parseLaunchArgs(process.argv, process.cwd())) {
    pendingLaunchRequests.push(request)
  }

  // App + first window are up: drain any launch requests captured during cold launch.
  appReady = true
  if (pendingLaunchRequests.length) {
    const requests = pendingLaunchRequests.splice(0)
    for (const request of requests) void openLaunchRequest(request)
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
