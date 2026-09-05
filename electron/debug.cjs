// Python debug sessions over the Debug Adapter Protocol, backed by debugpy.
//
// Wiring (decided by the Phase 1 spike): spawn the user's interpreter as
//   python -Xfrozen_modules=off -m debugpy --listen 127.0.0.1:<port> --wait-for-client <program>
// then connect a TCP DAP client to that port and drive an `attach` session. The child IS
// the debuggee, so its stdout/stderr are the program's output and killing it ends the
// session — no adapter middleman process to manage.
//
// Security posture: this module executes the user's own interpreter on a program file the
// caller must have already confined to the workspace (fs-ipc does resolution; this module
// never trusts renderer paths directly). execFile-style spawn (argument array, no shell);
// the DAP port binds to 127.0.0.1 only.
//
// This file deliberately imports nothing from Electron so it can be driven under plain
// node by scratchpad scripts (see pattern-testing-strategy). IPC wiring lives elsewhere.

'use strict'

const { spawn } = require('node:child_process')
const net = require('node:net')
const { EventEmitter } = require('node:events')
const { encodeMessage, createDecoder } = require('./dap-codec.cjs')

const REQUEST_TIMEOUT_MS = 8000
const CONNECT_RETRY_MS = 100
const CONNECT_RETRIES = 100 // ~10s for slow cold starts

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function connectWithRetry(port) {
  return new Promise((resolve, reject) => {
    let tries = 0
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => resolve(sock))
      sock.once('error', () => {
        if (++tries >= CONNECT_RETRIES) reject(new Error('debugpy: could not connect to adapter'))
        else setTimeout(attempt, CONNECT_RETRY_MS)
      })
    }
    attempt()
  })
}

// One live debug session: the spawned python child + the DAP socket.
// Emits: 'dap-event' (every DAP event), 'stdout' / 'stderr' (program output chunks as
// strings), 'exit' ({ code }) exactly once when the child ends.
class DebugSession extends EventEmitter {
  constructor(child, sock, { dap = true } = {}) {
    super()
    this.child = child
    this.sock = sock
    this.dap = dap // false for plain (noDebug) runs — no adapter behind the socket
    this.seq = 1
    this.pending = new Map() // seq -> { resolve, reject, timer, command }
    this.exited = false
    this.seenEvents = new Set() // events observed so far, so waitForEvent can't miss a fast one

    sock.on('data', createDecoder((msg) => this.onMessage(msg)))
    sock.on('error', () => {}) // socket teardown races child exit; exit is the signal
    sock.on('close', () => this.failAllPending(new Error('debug session closed')))

    child.stdout.on('data', (d) => this.emit('stdout', d.toString('utf8')))
    child.stderr.on('data', (d) => this.emit('stderr', d.toString('utf8')))
    child.on('exit', (code) => {
      this.exited = true
      this.failAllPending(new Error('debuggee exited'))
      this.emit('exit', { code })
    })
  }

  onMessage(msg) {
    if (msg.type === 'response') {
      const entry = this.pending.get(msg.request_seq)
      if (!entry) return
      this.pending.delete(msg.request_seq)
      clearTimeout(entry.timer)
      if (msg.success) entry.resolve(msg.body ?? {})
      else entry.reject(new Error(`DAP ${entry.command} failed: ${msg.message ?? 'unknown error'}`))
    } else if (msg.type === 'event') {
      this.seenEvents.add(msg.event)
      this.emit('dap-event', msg)
    }
  }

  failAllPending(err) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(err) }
    this.pending.clear()
  }

  // Send a request and await its response body. Rejects on adapter failure or timeout.
  request(command, args = {}, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const s = this.seq++
      const timer = setTimeout(() => {
        this.pending.delete(s)
        reject(new Error(`DAP ${command}: no response within ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(s, { resolve, reject, timer, command })
      this.sock.write(encodeMessage({ seq: s, type: 'request', command, arguments: args }))
    })
  }

  // `orAlreadySeen` resolves immediately if the named event has ALREADY fired. Use it
  // only for fire-once handshake events (e.g. `initialized`) where the payload doesn't
  // matter — NOT for recurring events like `stopped`. Without it, a fast adapter (rdbg)
  // can emit `initialized` in the microtask gap between the initialize response resolving
  // and this waiter being attached, and the handshake would hang until timeout.
  waitForEvent(name, { timeoutMs = REQUEST_TIMEOUT_MS, orAlreadySeen = false } = {}) {
    return new Promise((resolve, reject) => {
      if (orAlreadySeen && this.seenEvents.has(name)) { resolve(null); return }
      const timer = setTimeout(() => {
        this.off('dap-event', handler)
        reject(new Error(`DAP: no ${name} event within ${timeoutMs}ms`))
      }, timeoutMs)
      const handler = (msg) => {
        if (msg.event !== name) return
        clearTimeout(timer)
        this.off('dap-event', handler)
        resolve(msg)
      }
      this.on('dap-event', handler)
    })
  }

  // Convenience wrappers for the commands the UI uses.
  setBreakpoints(path, lines) {
    return this.request('setBreakpoints', {
      source: { path },
      breakpoints: lines.map((line) => ({ line })),
    })
  }
  configurationDone() { return this.request('configurationDone') }
  continue_(threadId) { return this.request('continue', { threadId }) }
  stepOver(threadId) { return this.request('next', { threadId }) }
  stepIn(threadId) { return this.request('stepIn', { threadId }) }
  stepOut(threadId) { return this.request('stepOut', { threadId }) }
  stackTrace(threadId) { return this.request('stackTrace', { threadId }) }
  scopes(frameId) { return this.request('scopes', { frameId }) }
  // `opts` may carry { filter:'indexed'|'named', start, count } for paged collection reads.
  variables(variablesReference, opts = {}) { return this.request('variables', { variablesReference, ...opts }) }

  // End the session: try a graceful disconnect, then make sure the child is gone. Safe
  // to call twice. Never leaves an orphaned debuggee.
  async kill() {
    if (this.dap) {
      try { await this.request('disconnect', { terminateDebuggee: true }, { timeoutMs: 1000 }) } catch { /* force below */ }
    }
    this.sock.destroy()
    if (!this.exited) {
      this.child.kill('SIGTERM')
      setTimeout(() => { if (!this.exited) this.child.kill('SIGKILL') }, 1500).unref()
    }
  }
}

/**
 * Spawn `program` under debugpy with `python` and complete the DAP handshake up to the
 * point where breakpoints can be set (the adapter's `initialized` event). The caller
 * then calls setBreakpoints(...) and configurationDone() to let the program run.
 *
 * DAP ordering gotcha (from the spike): the `attach` RESPONSE is withheld by debugpy
 * until after configurationDone, so it must not be awaited during the handshake — only
 * the `initialized` EVENT gates breakpoint setup.
 *
 * `noDebug` runs the program plainly (Run File): no adapter, no socket; the returned
 * session still emits stdout/stderr/exit but has no DAP surface.
 *
 * Language specifics come entirely from the passed spec (see electron/debug-adapters.cjs),
 * so this function has no per-language knowledge:
 *   debugBinary  — the adapter binary to spawn for a debug session (python, rdbg, …)
 *   runBinary    — the binary for a plain noDebug run (python, ruby, …)
 *   debugArgs(port, program) / runArgs(program) — argv builders after the binary
 *   env          — extra spawn env for the debug session
 *   initializeArgs / attachArgs — DAP handshake args
 */
async function launch({ debugBinary, runBinary, program, cwd, debugArgs, runArgs, env = {}, initializeArgs, attachArgs, noDebug = false }) {
  if (noDebug) {
    const child = spawn(runBinary, runArgs(program), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    return { session: new DebugSession(child, new net.Socket(), { dap: false }), capabilities: null }
  }

  const port = await freePort()
  const child = spawn(debugBinary, debugArgs(port, program), {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
  })

  let sock
  try {
    sock = await connectWithRetry(port)
  } catch (err) {
    child.kill('SIGKILL')
    throw err
  }

  const session = new DebugSession(child, sock)
  // Start waiting for `initialized` BEFORE issuing initialize — a fast adapter (rdbg)
  // emits it almost immediately after the response, and orAlreadySeen covers the case
  // where it lands before this waiter attaches.
  const capabilities = await session.request('initialize', initializeArgs)
  const initialized = session.waitForEvent('initialized', { orAlreadySeen: true })
  void session.request('attach', attachArgs).catch(() => {}) // acked post-configurationDone
  await initialized
  return { session, capabilities }
}

module.exports = { launch, DebugSession }
