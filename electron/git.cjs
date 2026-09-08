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

// One `git:log` record: header fields, then an optional shortstat tail.
function parseLogRecord(record) {
  const nl = record.indexOf('\n')
  const head = nl < 0 ? record : record.slice(0, nl)
  const tail = nl < 0 ? '' : record.slice(nl)
  const [hash, short, author, date, subject] = head.split('\x1f')
  const files = /(\d+) files? changed/.exec(tail)
  const ins = /(\d+) insertions?\(\+\)/.exec(tail)
  const del = /(\d+) deletions?\(-\)/.exec(tail)
  return {
    hash, short, author, date, subject: subject ?? '',
    files: files ? Number(files[1]) : 0,
    added: ins ? Number(ins[1]) : 0,
    deleted: del ? Number(del[1]) : 0,
  }
}

// Branch/ref names come from the renderer. Reject anything git could read as an option
// (leading `-`), a revision range (`..`), or a path escape; and always pass refs before
// `--` so a stray name can never become a pathspec.
function assertRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 256) throw new Error('Invalid ref')
  if (ref.startsWith('-') || ref.includes('..') || ref.includes('\0') || !/^[\w./+@~^-]+$/.test(ref) || /[~^:\s]/.test(ref)) {
    throw new Error('Invalid ref')
  }
}

// Repo-relative file path from the renderer. git treats paths from the repo root; reject
// escapes defensively (the confined read in fileDiff is the real gate for disk access).
function assertRepoPath(file) {
  if (typeof file !== 'string' || file.length === 0) throw new Error('file required')
  if (file.includes('\0') || path.isAbsolute(file) || file.split('/').includes('..') || file.startsWith('-')) {
    throw new Error('Invalid file path')
  }
}

// `blame --porcelain`: each line starts with "<hash> <orig> <final> [<count>]", then (for a
// hash's first appearance) key/value metadata lines, then a tab-prefixed content line.
function parseBlamePorcelain(out) {
  const lines = out.split('\n')
  const meta = new Map()
  const runs = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(lines[i])
    if (!m) continue
    const hash = m[1]
    const finalLine = Number(m[3])
    const info = meta.get(hash) ?? { author: '', time: 0, summary: '' }
    while (i + 1 < lines.length && !lines[i + 1].startsWith('\t')) {
      const l = lines[++i]
      if (l.startsWith('author ')) info.author = l.slice(7)
      else if (l.startsWith('author-time ')) info.time = Number(l.slice(12)) || 0
      else if (l.startsWith('summary ')) info.summary = l.slice(8)
    }
    i++ // the content line
    meta.set(hash, info)
    const last = runs[runs.length - 1]
    if (last && last.hash === hash && last.line + last.count === finalLine) last.count++
    else runs.push({ line: finalLine, count: 1, hash, short: hash.slice(0, 7), author: info.author, time: info.time, summary: info.summary })
  }
  // Metadata may arrive after the first run of a hash was pushed (git prints it once, on
  // the first line for that commit) — but that IS the first run, so fill from the map.
  for (const r of runs) { const info = meta.get(r.hash); if (info) { r.author = info.author; r.time = info.time; r.summary = info.summary } }
  return runs
}

function assertHash(hash) {
  if (typeof hash !== 'string' || !/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('Invalid commit hash')
}

// `--name-status -z` output: STATUS\0path\0, or STATUS\0old\0new\0 for renames/copies
// (status carries a similarity score, e.g. R100 — keep the letter).
function parseNameStatus(out) {
  const parts = out.split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const letter = parts[i][0]
    if (letter === 'R' || letter === 'C') {
      files.push({ path: parts[i + 2], oldPath: parts[i + 1], status: letter })
      i += 2
    } else {
      files.push({ path: parts[i + 1], status: letter })
      i += 1
    }
  }
  return files
}

// `--numstat -z` output: added\tdeleted\tpath\0, or added\tdeleted\t\0old\0new\0 for
// renames. Binary files report `-` for both counts. Keyed by (new) path.
function parseNumstat(out) {
  const parts = out.split('\0')
  const stats = new Map()
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry.includes('\t')) continue
    const [a, d, inline] = entry.split('\t')
    let file = inline
    if (file === '') { file = parts[i + 2]; i += 2 }
    const binary = a === '-' || d === '-'
    stats.set(file, { added: binary ? 0 : Number(a) || 0, deleted: binary ? 0 : Number(d) || 0, binary })
  }
  return stats
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
      const file = entry.slice(3)
      // Renames/copies put "new\0old" — the next NUL field is the old path.
      let oldPath
      if (xy[0] === 'R' || xy[0] === 'C') { oldPath = parts[++i] }
      const untracked = xy === '??'
      // Column X = index (staged) state, column Y = worktree (unstaged) state.
      const indexStatus = untracked || xy[0] === ' ' ? null : xy[0]
      const worktreeStatus = untracked ? 'U' : xy[1] === ' ' ? null : xy[1]
      files.push({ path: file, oldPath, status: statusBadge(xy), raw: xy, indexStatus, worktreeStatus })
    }
    return { files }
  })

  // Commit history, paginated. skip/limit drive the infinite scroll. `--shortstat` appends
  // a "N files changed, A insertions(+), D deletions(-)" line per commit (absent for empty
  // commits), which the row layout shows as +A −D.
  ipcMain.handle('git:log', async (event, skip, limit) => {
    const s = Number.isInteger(skip) && skip >= 0 ? skip : 0
    const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 50
    // Record separator \x1e starts each commit; fields split on \x1f. The shortstat line
    // follows the record on its own line(s), so it is parsed from the record's tail.
    const FMT = '%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s'
    const out = await runGit(event.sender.id, ['log', `--skip=${s}`, `--max-count=${n}`, '--shortstat', `--pretty=format:${FMT}`])
    const commits = out.split('\x1e').filter((r) => r.trim()).map(parseLogRecord)
    return { commits, hasMore: commits.length === n }
  })

  // Files changed in a single commit.
  ipcMain.handle('git:commitFiles', async (event, hash) => {
    assertHash(hash)
    const out = await runGit(event.sender.id, ['show', '--name-status', '--format=', '-z', hash])
    return { files: parseNameStatus(out).map(({ path, status }) => ({ path, status })) }
  })

  // Whole-commit review: header + every changed file with its line counts. Three
  // read-only `show` calls (header, name-status, numstat) joined by path — git has no
  // single format that yields status letters AND counts.
  ipcMain.handle('git:commitDetail', async (event, hash) => {
    const wcId = event.sender.id
    assertHash(hash)
    const FMT = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b'
    const [head, nameStatus, numstat] = await Promise.all([
      runGit(wcId, ['show', '-s', `--format=${FMT}`, hash]),
      runGit(wcId, ['show', '--name-status', '--format=', '-z', hash]),
      runGit(wcId, ['show', '--numstat', '--format=', '-z', hash]),
    ])
    const [fullHash, short, author, date, subject, body] = head.replace(/\n+$/, '').split('\x1f')
    const stats = parseNumstat(numstat)
    let added = 0, deleted = 0
    const files = parseNameStatus(nameStatus).map((f) => {
      const s = stats.get(f.path) ?? { added: 0, deleted: 0, binary: false }
      added += s.added; deleted += s.deleted
      return { ...f, ...s }
    })
    return { hash: fullHash, short, author, date, subject, body: (body ?? '').trim(), files, added, deleted }
  })


  // Local branches for the base picker. `current` marks HEAD's branch (null when detached).
  ipcMain.handle('git:branches', async (event) => {
    const wcId = event.sender.id
    const out = await runGit(wcId, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(objectname:short)%00%(committerdate:iso-strict)', 'refs/heads'])
    const branches = out.split('\n').filter(Boolean).map((line) => {
      const [name, short, date] = line.split('\0')
      return { name, short, date }
    })
    let current = null
    try { current = (await runGit(wcId, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() } catch { /* detached */ }
    if (current === 'HEAD') current = null
    return { branches, current }
  })

  // Commits on HEAD that are not on `base` (two-dot: base..HEAD), paginated like git:log.
  ipcMain.handle('git:rangeLog', async (event, base, skip, limit) => {
    assertRef(base)
    const s = Number.isInteger(skip) && skip >= 0 ? skip : 0
    const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 50
    const FMT = '%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s'
    const out = await runGit(event.sender.id, ['log', `--skip=${s}`, `--max-count=${n}`, '--shortstat', `--pretty=format:${FMT}`, `${base}..HEAD`, '--'])
    const commits = out.split('\x1e').filter((r) => r.trim()).map(parseLogRecord)
    return { commits, hasMore: commits.length === n }
  })

  // Branch review: everything HEAD changed since it diverged from `base` (three-dot:
  // base...HEAD, i.e. merge-base..HEAD), with per-file counts, plus the merge-base hash so
  // file diffs can show the "old" side as of the divergence point.
  ipcMain.handle('git:rangeDetail', async (event, base) => {
    const wcId = event.sender.id
    assertRef(base)
    // Unrelated histories (e.g. a backup branch from before a history rewrite) have no
    // merge base; say so instead of surfacing git's command line.
    let mergeBase
    try { mergeBase = await runGit(wcId, ['merge-base', base, 'HEAD']) } catch {
      throw new Error(`No common ancestor between ${base} and HEAD — the histories are unrelated`)
    }
    const [nameStatus, numstat, countOut] = await Promise.all([
      runGit(wcId, ['diff', '--name-status', '-z', `${base}...HEAD`, '--']),
      runGit(wcId, ['diff', '--numstat', '-z', `${base}...HEAD`, '--']),
      runGit(wcId, ['rev-list', '--count', `${base}..HEAD`, '--']),
    ])
    const stats = parseNumstat(numstat)
    let added = 0, deleted = 0
    const files = parseNameStatus(nameStatus).map((f) => {
      const s = stats.get(f.path) ?? { added: 0, deleted: 0, binary: false }
      added += s.added; deleted += s.deleted
      return { ...f, ...s }
    })
    return { base, mergeBase: mergeBase.trim(), commits: Number(countOut.trim()) || 0, files, added, deleted }
  })

  // Every commit that touched one file, following renames, paginated like git:log.
  ipcMain.handle('git:fileHistory', async (event, file, skip, limit) => {
    assertRepoPath(file)
    const s = Number.isInteger(skip) && skip >= 0 ? skip : 0
    const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100
    const FMT = '%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s'
    const out = await runGit(event.sender.id, ['log', '--follow', `--skip=${s}`, `--max-count=${n}`, '--shortstat', `--pretty=format:${FMT}`, '--', file])
    const commits = out.split('\x1e').filter((r) => r.trim()).map(parseLogRecord)
    return { commits, hasMore: commits.length === n }
  })

  // Line-by-line authorship of the working-tree file, compressed into runs of consecutive
  // lines from the same commit. Uncommitted lines carry the all-zero hash.
  ipcMain.handle('git:blame', async (event, file) => {
    assertRepoPath(file)
    const out = await runGit(event.sender.id, ['blame', '--porcelain', '--', file])
    return { runs: parseBlamePorcelain(out) }
  })

  // Diff for a file. mode 'working' = working tree vs index; mode 'staged' = index vs HEAD;
  // mode 'commit' = a commit vs its parent; mode 'range' = merge-base (hash) vs HEAD. Returns the old and new file text so the renderer can show a side-by-side
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

    if (mode === 'range') {
      // Branch review: old side = the file as of the merge-base with `base` (a resolved hash
      // supplied by git:rangeDetail), new side = HEAD.
      assertHash(hash)
      const [oldText, newText] = await Promise.all([show(hash), show('HEAD')])
      return { oldText, newText, oldLabel: `${hash.slice(0, 7)} (base)`, newLabel: 'HEAD' }
    }
    if (mode === 'commit') {
      assertHash(hash)
      const [oldText, newText] = await Promise.all([show(`${hash}^`), show(hash)])
      return { oldText, newText, oldLabel: `${hash.slice(0, 7)}^`, newLabel: hash.slice(0, 7) }
    }
    // staged: HEAD vs the index (`:<path>` is the staged blob).
    if (mode === 'staged') {
      const [oldText, newText] = await Promise.all([show('HEAD'), show('')])
      return { oldText, newText, oldLabel: 'HEAD', newLabel: 'Index' }
    }
    // working: index vs working tree (VS Code's unstaged diff), so a partially staged file
    // shows only what is not yet staged. An untracked file has no index blob → all added;
    // a deleted file has no disk file → all removed. The disk read is confined.
    const oldText = await show('')
    let newText = ''
    try {
      const real = await ws.resolveExisting(wcId, file)
      newText = require('node:fs').readFileSync(real, 'utf8')
    } catch { newText = '' }
    return { oldText, newText, oldLabel: 'Index', newLabel: 'Working Tree' }
  })
}

module.exports = { registerGitIpc }
