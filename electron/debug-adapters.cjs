'use strict'

// Per-language DAP adapter recipes. Each adapter knows ONLY how to launch its debugger
// and what handshake args it needs; the framing (`dap-codec`), the session state machine
// (`DebugSession`), and every renderer component are language-agnostic and unchanged.
//
// Recipes were established by scratchpad spikes (see the python-debugger and ruby-debugger
// plan memories), not guessed. Interpreter/adapter-binary RESOLUTION lives in debug-ipc.cjs
// (it needs Electron settings + the workspace); an adapter here is pure data + arg builders.

// Each adapter:
//   id, label, extensions[]       — identity + which files it debugs
//   settingKey                    — AppSettings key holding a user path override ('' = auto)
//   debugArgs(port, program)      — argv AFTER the resolved binary, for a debug session
//   runArgs(program)              — argv for a plain (noDebug) run under `runBinary`
//   env                           — extra env for the debug spawn (optional)
//   initializeArgs                — DAP `initialize` request args
//   attachArgs                    — DAP `attach` request args (withheld until configurationDone)
//   preflightArgs                 — argv to cheaply verify the toolchain is present
//   installHint(binary)           — message shown when preflight fails
const ADAPTERS = {
  python: {
    id: 'python',
    label: 'Python',
    extensions: ['.py'],
    settingKey: 'pythonPath',
    debugArgs: (port, program) => [
      '-Xfrozen_modules=off', '-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client', program,
    ],
    runArgs: (program) => ['-u', program],
    env: { PYDEVD_DISABLE_FILE_VALIDATION: '1' },
    initializeArgs: {
      clientID: 'khef-editor', adapterID: 'debugpy', pathFormat: 'path',
      linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true,
    },
    attachArgs: { justMyCode: true },
    // `import debugpy` — a real probe that the debug adapter (not just the interpreter) exists.
    preflightArgs: ['-c', 'import debugpy'],
    installHint: (binary) => `debugpy is not installed for ${binary}. Install it with:\n  ${binary} -m pip install debugpy`,
    // Alternate launch MODES that reuse this adapter's binary resolution, env, and DAP
    // handshake but swap the arg builders. Selected by debug-ipc via debug:start({mode}).
    // pytest: run/debug a test suite. `target` is a test file path or null (null = collect
    // from cwd = workspace root). `-m pytest` (not the console script) puts cwd on sys.path
    // so `from <pkg>…` imports resolve from inside tests/ even without a conftest. `-v` gives
    // one PASSED/FAILED line per test (a usable console results view); `-s` disables pytest's
    // stdout capture so print()s from tests stream live. debugpy binds test-file breakpoints
    // with the adapter's default justMyCode:true (verified — test code is user code).
    modes: {
      pytest: {
        debugArgs: (port, target) => [
          '-Xfrozen_modules=off', '-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client',
          '-m', 'pytest', '-v', '-s', ...(target ? [target] : []),
        ],
        runArgs: (target) => ['-m', 'pytest', '-v', '-s', ...(target ? [target] : [])],
        // pytest must exist too; debug sessions additionally need the base `import debugpy`.
        preflightArgs: ['-c', 'import pytest'],
        installHint: (binary) => `pytest is not installed for ${binary}. Install it with:\n  ${binary} -m pip install pytest`,
      },
    },
  },
  ruby: {
    id: 'ruby',
    label: 'Ruby',
    extensions: ['.rb'],
    settingKey: 'rdbgPath',
    // Spike findings (ruby-debugger plan): rdbg auto-detects DAP on the socket. `--open
    // --port` waits for the client to attach (do NOT add `--nonstop` — that makes rdbg run
    // the program to completion without waiting). rdbg then pauses at load (line 1,
    // reason:'pause'); `pausesAtEntry` below tells the client to auto-continue past it so
    // F5 runs to the first real breakpoint, matching debugpy. Resolved binary is `rdbg`.
    debugArgs: (port, program) => ['--open', `--port=${port}`, program],
    pausesAtEntry: true,
    // Plain runs use `ruby` (the runBinary), not rdbg.
    runArgs: (program) => [program],
    env: {},
    initializeArgs: {
      clientID: 'khef-editor', adapterID: 'rdbg', pathFormat: 'path',
      linesStartAt1: true, columnsStartAt1: true,
    },
    // localfs:true makes stack frames carry absolute filesystem paths (required for
    // click-to-open). Verified in the spike.
    attachArgs: { localfs: true },
    preflightArgs: ['--version'], // preflight runs against the rdbg binary directly
    installHint: (binary) => `Ruby debugging needs the 'debug' gem (rdbg). Install it with:\n  gem install debug\n(checked: ${binary})`,
  },
}

const EXT_TO_ADAPTER = new Map()
for (const a of Object.values(ADAPTERS)) for (const ext of a.extensions) EXT_TO_ADAPTER.set(ext, a)

function adapterForFile(filePath) {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return null
  return EXT_TO_ADAPTER.get(filePath.slice(dot).toLowerCase()) ?? null
}

// For the renderer's extension gating + error copy (via a debug:adapters IPC).
function adapterList() {
  return Object.values(ADAPTERS).map((a) => ({ id: a.id, label: a.label, extensions: a.extensions }))
}

module.exports = { ADAPTERS, adapterForFile, adapterList }
