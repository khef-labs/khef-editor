'use strict'

// IPC surface for Python debugging. One debug session per window (keyed by
// webContents.id, like workspace roots). SECURITY: the program path and every
// breakpoint path are resolved through the workspace confinement (ws.resolveExisting)
// — the renderer can only debug files inside its open workspace. The interpreter is
// the workspace's `.venv/bin/python` when present, else `python3` from PATH,
// overridable with the `pythonPath` app setting.
//
// The renderer gets NORMALIZED events on 'debug:event' — main runs the DAP
// choreography (e.g. on a stopped event it fetches the stack itself) so the renderer
// receives one event carrying the stopped file/line:
//   { kind: 'started' }
//   { kind: 'stopped', reason, path, line }
//   { kind: 'continued' }
//   { kind: 'output', channel: 'stdout'|'stderr', text }
//   { kind: 'ended', code }
//   { kind: 'error', message }

const { ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const ws = require('./workspace.cjs')
const { launch } = require('./debug.cjs')
const { loadSettings } = require('./settings.cjs')
const { ADAPTERS, adapterForFile, adapterList } = require('./debug-adapters.cjs')

// wcId -> { session, threadId, ended }
const sessions = new Map()

// Resolve a command via the user's LOGIN shell, exactly as their terminal would. A
// Finder-launched app inherits the GUI PATH (/usr/bin:/bin), missing version-manager
// shims (rvm/rbenv/nvm), so `command -v <x>` under `$SHELL -lc` is the reliable lookup.
// Cached per app run (keyed by command name); re-resolved only if the cached path vanishes.
const shellLookupCache = new Map()
function shellWhich(cmd) {
  const cached = shellLookupCache.get(cmd)
  if (cached && fs.existsSync(cached)) return Promise.resolve(cached)
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/bash'
    execFile(shell, ['-lc', `command -v ${cmd}`], { timeout: 8000 }, (err, stdout) => {
      const p = (stdout || '').trim().split('\n').pop()
      if (!err && p && fs.existsSync(p)) { shellLookupCache.set(cmd, p); resolve(p) }
      else resolve(null)
    })
  })
}

// Per-adapter resolution of { debugBinary, runBinary }. Order: explicit setting →
// language-specific auto → login-shell lookup → bare name. Returns strings (never throws);
// preflight decides whether the resolved binary actually works.
async function resolveBinaries(adapter, root) {
  const settings = await loadSettings()
  const override = (settings[adapter.settingKey] || '').trim()

  if (adapter.id === 'python') {
    let bin = override
    if (!bin) {
      const venv = path.join(root, '.venv', 'bin', 'python')
      bin = fs.existsSync(venv) ? venv : (await shellWhich('python3')) || 'python3'
    }
    // A pyenv/asdf SHIM re-execs pyenv on every launch (~3s each under the GUI app vs
    // ~0.08s for the real binary), and we spawn python several times per run — so a shim
    // makes a test run take 10-20s. Dereference to the real interpreter once (cached).
    bin = await realPython(bin)
    return { debugBinary: bin, runBinary: bin } // debugpy is `python -m debugpy`
  }

  if (adapter.id === 'ruby') {
    // The debug binary is rdbg; plain runs use ruby (prefer a sibling of the resolved
    // rdbg so the interpreter matches the debugger's ruby).
    const rdbg = override || (await shellWhich('rdbg')) || 'rdbg'
    const sibling = rdbg.includes('/') ? path.join(path.dirname(rdbg), 'ruby') : null
    const runBinary = sibling && fs.existsSync(sibling) ? sibling : (await shellWhich('ruby')) || 'ruby'
    return { debugBinary: rdbg, runBinary }
  }

  const bin = override || adapter.id
  return { debugBinary: bin, runBinary: bin }
}

// Resolve a python binary to its real `sys.executable`, dereferencing pyenv/asdf shims
// (which cost ~3s per spawn). Cached per resolved path. Falls back to the input on any
// failure, so a non-python or missing binary still flows to preflight for a clean error.
const realPythonCache = new Map()
function realPython(bin) {
  if (realPythonCache.has(bin)) return Promise.resolve(realPythonCache.get(bin))
  return new Promise((resolve) => {
    execFile(bin, ['-c', 'import sys; print(sys.executable)'], { timeout: 10000 }, (err, stdout) => {
      const real = (!err && (stdout || '').trim()) || bin
      realPythonCache.set(bin, real)
      resolve(real)
    })
  })
}

// Cheap toolchain probe (argv array, no shell) with explicit args.
function preflightWith(binary, args, cwd) {
  return new Promise((resolve) => {
    execFile(binary, args, { cwd, timeout: 10000 }, (err) => resolve(!err))
  })
}

// Probe using the adapter's own preflightArgs (e.g. `import debugpy`).
function preflight(adapter, debugBinary, cwd) {
  return preflightWith(debugBinary, adapter.preflightArgs, cwd)
}

function sendEvent(event, payload) {
  if (!event.sender.isDestroyed()) event.sender.send('debug:event', payload)
}

async function killSession(wcId) {
  const entry = sessions.get(wcId)
  if (!entry) return
  sessions.delete(wcId)
  entry.ended = true
  await entry.session.kill()
}

function registerDebugIpc() {
  // Start a session on `filePath` with breakpoints [{ path, lines }]. Any prior
  // session in this window is killed first (restart semantics).
  ipcMain.handle('debug:start', async (event, filePath, breakpoints, opts) => {
    const wcId = event.sender.id
    const root = ws.getWorkspaceRoot(wcId)
    if (!root) throw new Error('No workspace open')
    await killSession(wcId)
    const noDebug = !!(opts && opts.noDebug)
    const mode = (opts && opts.mode) || 'file'

    // 'file' (default): adapter chosen by the focused file's extension. 'pytest': always the
    // python adapter's pytest mode; the target is a test file OR null (null = collect from
    // the workspace root). The pytest launch args/preflight come from adapter.modes.pytest.
    let adapter, program, launchArgs, preflightArgs, installHint
    if (mode === 'pytest') {
      adapter = ADAPTERS.python
      const m = adapter.modes.pytest
      program = filePath ? await ws.resolveExisting(wcId, filePath) : null
      launchArgs = { debugArgs: m.debugArgs, runArgs: m.runArgs }
      preflightArgs = m.preflightArgs
      installHint = m.installHint
    } else {
      adapter = adapterForFile(filePath)
      if (!adapter) {
        const exts = adapterList().flatMap((a) => a.extensions).join(', ')
        throw new Error(`No debugger for this file type. Supported: ${exts}`)
      }
      program = await ws.resolveExisting(wcId, filePath)
      launchArgs = { debugArgs: adapter.debugArgs, runArgs: adapter.runArgs }
      preflightArgs = adapter.preflightArgs
      installHint = adapter.installHint
    }

    const { debugBinary, runBinary } = await resolveBinaries(adapter, root)
    // Preflight the tool that will actually run: for pytest, `import pytest` for BOTH run and
    // debug (a debug session also needs debugpy, checked after). For a plain script run there
    // is no tool to preflight.
    if (mode === 'pytest' && !(await preflightWith(debugBinary, preflightArgs, root))) {
      throw new Error(installHint(debugBinary))
    }
    if (!noDebug && !(await preflight(adapter, debugBinary, root))) {
      // adapter.preflight (import debugpy) — only debug sessions load the DAP adapter.
      throw new Error(adapter.installHint(debugBinary))
    }

    const { session } = await launch({
      debugBinary, runBinary, program, cwd: root, noDebug,
      debugArgs: launchArgs.debugArgs, runArgs: launchArgs.runArgs, env: adapter.env,
      initializeArgs: adapter.initializeArgs, attachArgs: adapter.attachArgs,
    })
    // Adapters that suspend at load (rdbg) surface a synthetic entry pause before the
    // program runs. Swallow that FIRST stop and auto-continue, so the user only ever sees
    // real breakpoint/step stops — matching debugpy, which has no entry pause.
    const entry = { session, threadId: null, ended: false, swallowEntryPause: !noDebug && !!adapter.pausesAtEntry }
    sessions.set(wcId, entry)

    const end = (code) => {
      if (entry.ended) return
      entry.ended = true
      sessions.delete(wcId)
      sendEvent(event, { kind: 'ended', code: code ?? null })
    }

    // onOutput/onExit replay anything the child emitted before we attached (a fast pytest
    // run can finish in the gap after launch() returns — see DebugSession).
    // onOutput/onExit replay anything the child emitted before we attached (a fast pytest
    // run can finish in the gap after launch() returns — see DebugSession).
    session.onOutput((channel, text) => sendEvent(event, { kind: 'output', channel, text }))
    session.onExit(({ code }) => end(code))
    session.on('dap-event', (msg) => {
      if (msg.event === 'stopped') {
        const threadId = msg.body?.threadId
        entry.threadId = threadId
        // Auto-continue past an adapter's one-time load pause (see swallowEntryPause).
        if (entry.swallowEntryPause) {
          entry.swallowEntryPause = false
          void session.continue_(threadId).catch(() => {})
          return
        }
        // Fetch the top frame here so the renderer gets location in one event.
        session.stackTrace(threadId).then(
          (st) => {
            const top = st.stackFrames?.[0]
            sendEvent(event, {
              kind: 'stopped',
              reason: msg.body?.reason ?? 'unknown',
              path: top?.source?.path ?? null,
              line: top?.line ?? null,
            })
          },
          () => sendEvent(event, { kind: 'stopped', reason: msg.body?.reason ?? 'unknown', path: null, line: null }),
        )
      } else if (msg.event === 'continued') {
        sendEvent(event, { kind: 'continued' })
      } else if (msg.event === 'terminated') {
        end(null)
      }
    })

    // Apply breakpoints (paths confined), then let the program run. A noDebug session
    // has no DAP surface — the child is already running.
    if (!noDebug) {
      for (const bp of Array.isArray(breakpoints) ? breakpoints : []) {
        const real = await ws.resolveExisting(wcId, bp.path)
        const lines = (bp.lines ?? []).filter((n) => Number.isInteger(n) && n > 0)
        if (lines.length > 0) await session.setBreakpoints(real, lines)
      }
      await session.configurationDone()
    }
    sendEvent(event, { kind: 'started' })
    return { ok: true, adapter: adapter.id, binary: debugBinary }
  })

  // Live-update breakpoints for one file while a session runs (no-op when idle).
  ipcMain.handle('debug:setBreakpoints', async (event, filePath, lines) => {
    const entry = sessions.get(event.sender.id)
    if (!entry || entry.ended) return { active: false }
    const real = await ws.resolveExisting(event.sender.id, filePath)
    const clean = (lines ?? []).filter((n) => Number.isInteger(n) && n > 0)
    await entry.session.setBreakpoints(real, clean)
    return { active: true }
  })

  // Stepping/continue act on the thread from the most recent stopped event.
  ipcMain.handle('debug:command', async (event, command) => {
    const entry = sessions.get(event.sender.id)
    if (!entry || entry.ended || entry.threadId == null) return { ok: false }
    const s = entry.session
    const fns = {
      continue: () => s.continue_(entry.threadId),
      stepOver: () => s.stepOver(entry.threadId),
      stepIn: () => s.stepIn(entry.threadId),
      stepOut: () => s.stepOut(entry.threadId),
    }
    const fn = fns[command]
    if (!fn) throw new Error(`Unknown debug command: ${command}`)
    await fn()
    return { ok: true }
  })

  ipcMain.handle('debug:stop', async (event) => {
    const had = sessions.has(event.sender.id)
    await killSession(event.sender.id)
    // killSession marks the entry ended, which suppresses the child-exit 'ended' event
    // (that guard exists so a restart's kill-of-the-old-session can't emit a stale
    // 'ended' after the new session's 'started'). An explicit stop must therefore send
    // its own — without this the renderer stays in debug mode forever.
    if (had) sendEvent(event, { kind: 'ended', code: null })
    return { ok: true }
  })

  // Inspection (used by the Run and Debug sidebar).
  ipcMain.handle('debug:stackTrace', async (event) => {
    const entry = sessions.get(event.sender.id)
    if (!entry || entry.ended || entry.threadId == null) return { stackFrames: [] }
    return entry.session.stackTrace(entry.threadId)
  })
  ipcMain.handle('debug:scopes', async (event, frameId) => {
    const entry = sessions.get(event.sender.id)
    if (!entry || entry.ended) return { scopes: [] }
    return entry.session.scopes(frameId)
  })
  // `opts` = { filter?: 'indexed'|'named', start?, count? } for paged collection reads.
  ipcMain.handle('debug:variables', async (event, variablesReference, opts) => {
    const entry = sessions.get(event.sender.id)
    if (!entry || entry.ended) return { variables: [] }
    return entry.session.variables(variablesReference, opts || {})
  })

  // Which languages the debugger supports — the renderer gates F5/Run on this instead
  // of hard-coding a `.py` list.
  ipcMain.handle('debug:adapters', async () => adapterList())
}

// Quit-path safety net: kill every live debuggee (per-window cleanup normally handles
// this via 'closed', but a hidden last window never closes — it must not leak a child).
async function killAllDebugSessions() {
  await Promise.all([...sessions.keys()].map((wcId) => killSession(wcId)))
}

module.exports = { registerDebugIpc, killDebugSession: killSession, killAllDebugSessions }
