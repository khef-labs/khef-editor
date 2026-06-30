'use strict'

// Project-wide text search, confined to the open workspace root. Uses ripgrep when
// available (fast, respects .gitignore + our ignore set) and falls back to a bounded
// Node fs walk otherwise. Returns matches grouped by file.

const { ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const fsp = require('node:fs/promises')
const fssync = require('node:fs')
const path = require('node:path')
const ws = require('./workspace.cjs')

const MAX_RESULTS = 2000         // hard cap on total matches returned
const MAX_FILE_BYTES = 1_000_000 // skip files larger than this in the fallback walk

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '__pycache__', '.next', '.nuxt',
  'dist', 'dist-app', '.cache', '.turbo', '.parcel-cache', 'coverage', '.vite',
  'build', 'target', 'out',
])

// Candidate ripgrep locations — Electron's PATH is minimal in a packaged app.
const RG_CANDIDATES = [
  '/opt/homebrew/bin/rg',
  '/usr/local/bin/rg',
  '/usr/bin/rg',
]

function findRipgrep() {
  for (const p of RG_CANDIDATES) {
    try {
      if (fssync.existsSync(p)) return p
    } catch { /* ignore */ }
  }
  return null // fall back to Node walk
}

// Run ripgrep with --json, parsing matches into { file, path, matches[] } records.
function searchWithRipgrep(rgPath, root, query, opts) {
  return new Promise((resolve) => {
    const args = ['--json', '--line-number', '--column']
    if (!opts.caseSensitive) args.push('--ignore-case')
    if (opts.wholeWord) args.push('--word-regexp')
    if (!opts.regex) args.push('--fixed-strings')
    args.push('--', query, '.')

    const child = spawn(rgPath, args, { cwd: root })
    const byFile = new Map()
    let count = 0
    let buf = ''

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (obj.type !== 'match') continue
        const rel = obj.data.path.text.replace(/^\.\//, '')
        const abs = path.join(root, rel)
        const lineNum = obj.data.line_number
        const text = (obj.data.lines.text || '').replace(/\n$/, '')
        const submatches = obj.data.submatches || []
        for (const sm of submatches) {
          if (count >= MAX_RESULTS) { child.kill(); break }
          if (!byFile.has(rel)) byFile.set(rel, { file: rel, path: abs, matches: [] })
          byFile.get(rel).matches.push({ line: lineNum, col: sm.start + 1, text, matchStart: sm.start, matchEnd: sm.end })
          count++
        }
        if (count >= MAX_RESULTS) { child.kill(); break }
      }
    })
    child.on('error', () => resolve(null)) // signal fallback to caller
    child.on('close', () => resolve({ files: [...byFile.values()], total: count, truncated: count >= MAX_RESULTS }))
  })
}

// Fallback: bounded Node fs walk + per-line search.
async function searchWithWalk(root, query, opts) {
  const byFile = new Map()
  let count = 0
  const needle = opts.caseSensitive ? query : query.toLowerCase()
  let re = null
  if (opts.regex) {
    try { re = new RegExp(query, opts.caseSensitive ? 'g' : 'gi') } catch { re = null }
  }

  function addMatch(abs, line, start, end, text) {
    const rel = path.relative(root, abs)
    if (!byFile.has(rel)) byFile.set(rel, { file: rel, path: abs, matches: [] })
    byFile.get(rel).matches.push({ line, col: start + 1, text, matchStart: start, matchEnd: end })
    count++
  }

  async function walk(absDir) {
    if (count >= MAX_RESULTS) return
    let dirents
    try { dirents = await fsp.readdir(absDir, { withFileTypes: true }) } catch { return }
    for (const d of dirents) {
      if (count >= MAX_RESULTS) return
      if (d.isSymbolicLink()) continue
      const abs = path.join(absDir, d.name)
      if (d.isDirectory()) {
        if (IGNORED_DIRS.has(d.name)) continue
        await walk(abs)
      } else if (d.isFile()) {
        let stat
        try { stat = await fsp.stat(abs) } catch { continue }
        if (stat.size > MAX_FILE_BYTES) continue
        let bytes
        try { bytes = await fsp.readFile(abs) } catch { continue }
        if (bytes.includes(0)) continue // skip binary files (NUL byte)
        const content = bytes.toString('utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length && count < MAX_RESULTS; i++) {
          const rawLine = lines[i]
          if (re) {
            re.lastIndex = 0
            let m
            while ((m = re.exec(rawLine)) && count < MAX_RESULTS) {
              addMatch(abs, i + 1, m.index, m.index + m[0].length, rawLine)
              if (m[0].length === 0) re.lastIndex++
            }
          } else {
            const hay = opts.caseSensitive ? rawLine : rawLine.toLowerCase()
            let from = 0
            let idx
            while ((idx = hay.indexOf(needle, from)) >= 0 && count < MAX_RESULTS) {
              addMatch(abs, i + 1, idx, idx + query.length, rawLine)
              from = idx + Math.max(1, query.length)
            }
          }
        }
      }
    }
  }

  await walk(root)
  return { files: [...byFile.values()], total: count, truncated: count >= MAX_RESULTS }
}

function registerSearchIpc() {
  const rgPath = findRipgrep()

  ipcMain.handle('fs:search', async (_event, query, options) => {
    const root = ws.getWorkspaceRoot()
    if (!root) throw new Error('No workspace open')
    if (typeof query !== 'string' || query.length === 0) {
      return { files: [], total: 0, truncated: false }
    }
    const opts = {
      caseSensitive: !!(options && options.caseSensitive),
      wholeWord: !!(options && options.wholeWord),
      regex: !!(options && options.regex),
    }
    if (rgPath) {
      const res = await searchWithRipgrep(rgPath, root, query, opts)
      if (res) return res // null means rg failed at runtime → fall through to walk
    }
    return searchWithWalk(root, query, opts)
  })

  // Replace all occurrences of `query` with `replacement` across the workspace.
  // Writes directly to disk (undoable via git, like VS Code). Each target path is
  // confined to the workspace root before writing.
  ipcMain.handle('fs:replaceAll', async (_event, query, replacement, options) => {
    const root = ws.getWorkspaceRoot()
    if (!root) throw new Error('No workspace open')
    if (typeof query !== 'string' || query.length === 0) {
      return { filesChanged: 0, replacements: 0 }
    }
    const repl = typeof replacement === 'string' ? replacement : ''
    const opts = {
      caseSensitive: !!(options && options.caseSensitive),
      wholeWord: !!(options && options.wholeWord),
      regex: !!(options && options.regex),
    }

    // Find the files with matches (reuse search).
    let search
    if (rgPath) search = await searchWithRipgrep(rgPath, root, query, opts)
    if (!search) search = await searchWithWalk(root, query, opts)

    // Build the matching regex. For fixed strings, escape; for regex, use as-is.
    const flags = opts.caseSensitive ? 'g' : 'gi'
    let pattern = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`
    let re
    try { re = new RegExp(pattern, flags) } catch { throw new Error('Invalid search pattern') }

    let filesChanged = 0
    let replacements = 0
    for (const fr of search.files) {
      let abs
      try { abs = await ws.resolveExisting(fr.file) } catch { continue } // outside root → skip
      let content
      try { content = await fsp.readFile(abs, 'utf8') } catch { continue }
      let count = 0
      const updated = content.replace(re, (m) => { count++; return opts.regex ? expandRefs(repl, m, re, content) : repl })
      if (count > 0 && updated !== content) {
        try {
          await fsp.writeFile(abs, updated, 'utf8')
          filesChanged++
          replacements += count
        } catch { /* skip unwritable */ }
      }
    }
    return { filesChanged, replacements }
  })
}

// For regex mode, support $1/$2 backreferences in the replacement. We re-run the regex
// per match to get capture groups (simpler than threading them through .replace).
function expandRefs(repl, matched, re, _content) {
  // Recompute groups for this specific match.
  const single = new RegExp(re.source, re.flags.replace('g', ''))
  const m = single.exec(matched)
  if (!m) return repl
  return repl.replace(/\$(\d+)/g, (_, n) => m[Number(n)] ?? '')
}

module.exports = { registerSearchIpc }
