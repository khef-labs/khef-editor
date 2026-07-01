'use strict'

// Read-only git integration. SECURITY: git is run with execFile (argv array, NO shell),
// so file names and refs can never be interpreted as shell. Every invocation is hardened
// per the security review:
//   - cwd is the confined workspace root (from workspace.cjs); refuse if none open.
//   - `-c core.hooksPath=/dev/null` so no repo hook can execute.
//   - `-c core.fsmonitor=false` and `--no-optional-locks` so reads never spawn watchers
//     or take locks.
//   - `--no-pager` so nothing tries to launch a pager.
// Only read subcommands are exposed (status/log/show/diff). There is NO write path —
// nothing here stages, commits, pushes, or mutates the repo.

const { ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const path = require('node:path')
const ws = require('./workspace.cjs')

const MAX_BUFFER = 16 * 1024 * 1024 // 16MB cap on git output
const GIT_TIMEOUT = 15000

const HARDENING = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '--no-optional-locks',
  '--no-pager',
]

// Run a read-only git command in a window's workspace root. The window id is an
// explicit parameter (never inferred from a global or focused window) so concurrent
// git IPC from two windows cannot race. Rejects if that window has no workspace open.
function runGit(wcId, args) {
  const root = ws.getWorkspaceRoot(wcId)
  if (!root) return Promise.reject(new Error('No workspace open'))
  return new Promise((resolve, reject) => {
    execFile('git', [...HARDENING, ...args], {
      cwd: root,
      timeout: GIT_TIMEOUT,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        // Not a git repo, or git missing — surface a clean message.
        const msg = (stderr || err.message || '').trim()
        reject(new Error(msg || 'git command failed'))
        return
      }
      resolve(stdout)
    })
  })
}

// Map a git porcelain status code to a single-letter badge used by the UI.
function statusBadge(xy) {
  // xy is the two-char XY status (e.g. ' M', 'A ', '??', 'MM').
  if (xy === '??') return 'U' // untracked
  const x = xy[0]
  const y = xy[1]
  // Prefer the worktree (y) status, falling back to index (x).
  const c = y !== ' ' && y !== undefined ? y : x
  if (c === 'A') return 'A'
  if (c === 'D') return 'D'
  if (c === 'R') return 'R'
  if (c === 'M') return 'M'
  return 'M'
}

async function isGitRepo(wcId) {
  try {
    const out = await runGit(wcId, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

function registerGitIpc() {
  // Is the open workspace a git repo? Plus current branch.
  ipcMain.handle('git:info', async (event) => {
    const wcId = event.sender.id
    if (!ws.getWorkspaceRoot(wcId)) return { isRepo: false, branch: null }
    const repo = await isGitRepo(wcId)
    if (!repo) return { isRepo: false, branch: null }
    let branch = null
    try { branch = (await runGit(wcId, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() } catch { /* detached */ }
    return { isRepo: true, branch }
  })

  // Working-tree changes (porcelain v1, -z NUL-delimited so filenames are safe).
  ipcMain.handle('git:status', async (event) => {
    const out = await runGit(event.sender.id, ['status', '--porcelain', '-z', '--untracked-files=all'])
    const parts = out.split('\0').filter(Boolean)
    const files = []
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]
      const xy = entry.slice(0, 2)
      let file = entry.slice(3)
      // Renames/copies put "old\0new" — the next NUL field is the old path.
      if (xy[0] === 'R' || xy[0] === 'C') { i++ /* skip old path field */ }
      files.push({ path: file, status: statusBadge(xy), raw: xy })
    }
    return { files }
  })

  // Commit history, paginated. skip/limit drive the infinite scroll.
  ipcMain.handle('git:log', async (event, skip, limit) => {
    const s = Number.isInteger(skip) && skip >= 0 ? skip : 0
    const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 50
    // Use a record/field separator unlikely to appear in messages.
    const FMT = '%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e'
    const out = await runGit(event.sender.id, ['log', `--skip=${s}`, `--max-count=${n}`, '--date=short', `--pretty=format:${FMT}`])
    const commits = out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
      const [hash, short, author, date, subject] = r.split('\x1f')
      return { hash, short, author, date, subject }
    })
    return { commits, hasMore: commits.length === n }
  })

  // Files changed in a single commit.
  ipcMain.handle('git:commitFiles', async (event, hash) => {
    if (typeof hash !== 'string' || !/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('Invalid commit hash')
    const out = await runGit(event.sender.id, ['show', '--name-status', '--format=', '-z', hash])
    const parts = out.split('\0').filter(Boolean)
    const files = []
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i]
      const letter = code[0]
      if (letter === 'R' || letter === 'C') {
        // status, old, new
        const newPath = parts[i + 2]
        files.push({ path: newPath, status: letter })
        i += 2
      } else {
        const file = parts[i + 1]
        files.push({ path: file, status: letter })
        i += 1
      }
    }
    return { files }
  })

  // Diff for a file. mode 'working' = working tree vs HEAD; mode 'commit' = a commit vs
  // its parent. Returns the old and new file text so the renderer can show a side-by-side
  // diff. Old/new come from `git show <ref>:<path>` (read-only, no checkout).
  ipcMain.handle('git:fileDiff', async (event, args) => {
    const wcId = event.sender.id
    const { mode, file, hash } = args || {}
    if (typeof file !== 'string' || file.length === 0) throw new Error('file required')
    // git treats paths from the repo root; reject path escapes defensively.
    if (file.includes('\0') || path.isAbsolute(file) || file.split('/').includes('..')) {
      throw new Error('Invalid file path')
    }

    async function show(ref) {
      try { return await runGit(wcId, ['show', `${ref}:${file}`]) } catch { return '' }
    }

    if (mode === 'commit') {
      if (typeof hash !== 'string' || !/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('Invalid commit hash')
      const [oldText, newText] = await Promise.all([show(`${hash}^`), show(hash)])
      return { oldText, newText, oldLabel: `${hash.slice(0, 7)}^`, newLabel: hash.slice(0, 7) }
    }
    // working: HEAD vs working tree (read the file from disk via confined read).
    const oldText = await show('HEAD')
    let newText = ''
    try {
      const real = await ws.resolveExisting(wcId, file)
      newText = require('node:fs').readFileSync(real, 'utf8')
    } catch { newText = '' }
    return { oldText, newText, oldLabel: 'HEAD', newLabel: 'Working Tree' }
  })
}

module.exports = { registerGitIpc }
