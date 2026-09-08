import { useEffect, useRef, useState, useCallback } from 'preact/hooks'
import { ChevronRight, ChevronDown, RefreshCw, GitBranch, GitCompareArrows, ClipboardCopy, X } from 'lucide-preact'
import type { GitChange, GitCommit, GitBranch as GitBranchInfo } from '../../../electron/types'
import type { DiffSpec } from './DiffView'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { relativeTime } from '../lib/relativeTime'
import { groupNotes, notesToMarkdown, removeNote, parseNoteRef } from '../lib/reviewNotes'
import { reviewNotesStore, useReviewNotes } from '../lib/reviewNotesStore'

interface SourceControlPanelProps {
  // Re-fetch trigger: bump to refresh (e.g. when the panel becomes visible or a file saves).
  refreshToken: number
  // Workspace root, for turning git's repo-relative paths into absolute ones.
  rootPath: string | null
  onOpenDiff: (spec: DiffSpec, title: string) => void
  // Open a commit as a review page (all files stacked).
  onOpenReview: (commit: GitCommit) => void
  // Open the current branch's changes since `base` as a review page.
  onOpenBranchReview: (base: string) => void
  // Open a file's commit history as a tab.
  onOpenHistory: (relPath: string) => void
  // Open the diff a review note belongs to (ref as in reviewNotes.ts).
  onOpenNoteDiff: (ref: string, file: string) => void
  // Open the file itself (current working-tree version) as an editor tab.
  onOpenFile: (relPath: string) => void
  // Select + scroll the file into view in the Explorer sidebar.
  onRevealInExplorer: (relPath: string) => void
}

const PAGE = 50
const badgeTitle: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', U: 'Untracked' }

function basename(p: string): string { return p.split('/').pop() ?? p }
// Human label for a note ref: "commit abc1234", "Working tree", "Staged", "branch since abc1234".
function noteRefLabel(ref: string): string {
  const r = parseNoteRef(ref)
  if (!r) return ref
  if (r.mode === 'working') return 'Working tree'
  if (r.mode === 'staged') return 'Staged'
  if (r.mode === 'range') return `branch since ${(r.hash ?? '').slice(0, 7)}`
  return `commit ${(r.hash ?? '').slice(0, 7)}`
}
function dirname(p: string): string { const b = basename(p); return p.slice(0, p.length - b.length - 1) }

export function SourceControlPanel({ refreshToken, rootPath, onOpenDiff, onOpenReview, onOpenBranchReview, onOpenHistory, onOpenNoteDiff, onOpenFile, onRevealInExplorer }: SourceControlPanelProps) {
  const [isRepo, setIsRepo] = useState<boolean | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [changes, setChanges] = useState<GitChange[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [changesOpen, setChangesOpen] = useState(true)
  const [stagedOpen, setStagedOpen] = useState(true)
  const [notesOpen, setNotesOpen] = useState(true)
  const notes = useReviewNotes()
  const [graphOpen, setGraphOpen] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [commitFiles, setCommitFiles] = useState<Record<string, GitChange[]>>({})
  // Right-click menu on a file row (Changes or a commit's files). `deleted` disables
  // Open File — a 'D' row has no working-tree file to open.
  const [fileMenu, setFileMenu] = useState<{ path: string; deleted: boolean; x: number; y: number } | null>(null)
  // Right-click menu on a commit row.
  const [commitMenu, setCommitMenu] = useState<{ commit: GitCommit; x: number; y: number } | null>(null)
  // Graph mode: all commits, or only those on HEAD since `base` (branch review).
  const [mode, setMode] = useState<'commits' | 'branch'>('commits')
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [base, setBase] = useState<string | null>(null)
  const graphRef = useRef<HTMLDivElement>(null)

  const openFileMenu = (e: MouseEvent, path: string, status: string) => {
    e.preventDefault()
    setFileMenu({ path, deleted: status === 'D', x: e.clientX, y: e.clientY })
  }

  const load = useCallback(async () => {
    try {
      const info = await window.editorApi.git.info()
      setIsRepo(info.isRepo)
      setBranch(info.branch)
      if (!info.isRepo) { setChanges([]); setCommits([]); return }
      const [st, log] = await Promise.all([
        window.editorApi.git.status(),
        mode === 'branch' && base ? window.editorApi.git.rangeLog(base, 0, PAGE) : window.editorApi.git.log(0, PAGE),
      ])
      setChanges(st.files)
      setCommits(log.commits)
      setHasMore(log.hasMore)
    } catch {
      setIsRepo(false)
    }
  }, [mode, base])

  useEffect(() => { void load() }, [load, refreshToken])

  // Local branches (minus the current one) for the base picker. The base is remembered per
  // repository in settings; first time, prefer main/master, else the most recent branch.
  useEffect(() => {
    if (isRepo !== true) return
    let cancelled = false
    Promise.all([window.editorApi.git.branches(), window.editorApi.getSettings()]).then(([r, settings]) => {
      if (cancelled) return
      const others = r.branches.filter((b) => b.name !== r.current)
      setBranches(others)
      setBase((prev) => {
        if (prev && others.some((b) => b.name === prev)) return prev
        const saved = rootPath ? settings.reviewBase?.[rootPath] : undefined
        const pick = [saved, 'main', 'master'].find((n) => n && others.some((b) => b.name === n)) ?? others[0]?.name ?? null
        return pick
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isRepo, refreshToken, rootPath])

  const chooseBase = (name: string) => {
    setBase(name)
    if (rootPath) {
      window.editorApi.getSettings().then((s) => window.editorApi.setSettings({ reviewBase: { ...(s.reviewBase ?? {}), [rootPath]: name } })).catch(() => {})
    }
  }

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const log = mode === 'branch' && base
        ? await window.editorApi.git.rangeLog(base, commits.length, PAGE)
        : await window.editorApi.git.log(commits.length, PAGE)
      setCommits((prev) => [...prev, ...log.commits])
      setHasMore(log.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, commits.length, mode, base])

  // Infinite scroll on the graph list.
  const onGraphScroll = useCallback((e: Event) => {
    const el = e.currentTarget as HTMLDivElement
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) void loadMore()
  }, [loadMore])

  const toggleCommit = useCallback(async (hash: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash); else next.add(hash)
      return next
    })
    if (!commitFiles[hash]) {
      try {
        const r = await window.editorApi.git.commitFiles(hash)
        setCommitFiles((prev) => ({ ...prev, [hash]: r.files as GitChange[] }))
      } catch { /* ignore */ }
    }
  }, [commitFiles])

  // Split porcelain rows into the two VS Code sections. A partially staged file appears in both.
  const staged = changes.filter((c) => c.indexStatus)
  const unstaged = changes.filter((c) => c.worktreeStatus)

  if (isRepo === false) {
    return (
      <div class="scm-panel" data-testid="scm-panel">
        <div class="sidebar-header">Source Control</div>
        <div class="sidebar-empty"><p class="hint">The open folder is not a Git repository.</p></div>
      </div>
    )
  }

  return (
    <div class="scm-panel" data-testid="scm-panel">
      <div class="scm-titlebar">
        <span class="sidebar-header">Source Control</span>
        <span class="scm-actions">
          {branch && <span class="scm-branch"><GitBranch size={13} /> {branch}</span>}
          <button class="scm-tool" title="Refresh" onClick={() => void load()}><RefreshCw size={15} /></button>
        </span>
      </div>

      {/* STAGED CHANGES (index vs HEAD) — only shown when something is staged. */}
      {staged.length > 0 && (
        <>
          <button class="scm-section-header" onClick={() => setStagedOpen((v) => !v)}>
            {stagedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Staged Changes</span>
            <span class="scm-count">{staged.length}</span>
          </button>
          {stagedOpen && (
            <div class="scm-list">
              {staged.map((c) => (
                <div
                  key={`s:${c.path}`}
                  class="scm-file-row"
                  title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
                  onClick={() => onOpenDiff({ mode: 'staged', file: c.path }, `${basename(c.path)} (Staged)`)}
                  onContextMenu={(e) => openFileMenu(e, c.path, c.indexStatus ?? c.status)}
                >
                  <span class="scm-file-name">{basename(c.path)}</span>
                  <span class="scm-file-dir">{dirname(c.path)}</span>
                  <span class={`scm-badge badge-${c.indexStatus}`} title={badgeTitle[c.indexStatus ?? ''] ?? c.indexStatus}>{c.indexStatus}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* CHANGES (working tree vs index, including untracked) */}
      <button class="scm-section-header" onClick={() => setChangesOpen((v) => !v)}>
        {changesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Changes</span>
        {unstaged.length > 0 && <span class="scm-count">{unstaged.length}</span>}
      </button>
      {changesOpen && (
        <div class="scm-list">
          {unstaged.length === 0 && <div class="scm-empty-row">{staged.length > 0 ? 'No unstaged changes' : 'No changes'}</div>}
          {unstaged.map((c) => (
            <div
              key={c.path}
              class="scm-file-row"
              title={c.path}
              onClick={() => onOpenDiff({ mode: 'working', file: c.path }, `${basename(c.path)} (Working Tree)`)}
              onContextMenu={(e) => openFileMenu(e, c.path, c.worktreeStatus ?? c.status)}
            >
              <span class="scm-file-name">{basename(c.path)}</span>
              <span class="scm-file-dir">{dirname(c.path)}</span>
              <span class={`scm-badge badge-${c.worktreeStatus}`} title={badgeTitle[c.worktreeStatus ?? ''] ?? c.worktreeStatus}>{c.worktreeStatus}</span>
            </div>
          ))}
        </div>
      )}

      {/* REVIEW NOTES (local, per repository) */}
      {notes.length > 0 && (
        <>
          <div class="scm-section-header scm-graph-header">
            <button class="scm-section-toggle" onClick={() => setNotesOpen((v) => !v)}>
              {notesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Notes</span>
              <span class="scm-count">{notes.length}</span>
            </button>
            <button class="scm-tool" title="Copy all notes as Markdown" onClick={() => void navigator.clipboard.writeText(notesToMarkdown(notes, noteRefLabel))}><ClipboardCopy size={14} /></button>
          </div>
          {notesOpen && (
            <div class="scm-list scm-notes">
              {groupNotes(notes).map((g) => (
                <div key={g.ref} class="scm-note-group">
                  <div class="scm-note-ref">{noteRefLabel(g.ref)}</div>
                  {g.files.map((f) => f.notes.map((n) => (
                    <div key={n.id} class="scm-note-row" title={n.text} onClick={() => onOpenNoteDiff(n.ref, n.file)}>
                      <span class="scm-note-loc">{basename(f.file)}:{n.line}{n.side === 'old' ? ' (old)' : ''}</span>
                      <span class="scm-note-text">{n.text}</span>
                      <button class="scm-note-delete" title="Delete note" onClick={(e) => { e.stopPropagation(); reviewNotesStore.set(removeNote(reviewNotesStore.get(), n.id)) }}><X size={12} /></button>
                    </div>
                  )))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* GRAPH (commit history, infinite scroll) */}
      <div class="scm-section-header scm-graph-header">
        <button class="scm-section-toggle" onClick={() => setGraphOpen((v) => !v)}>
          {graphOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{mode === 'branch' ? 'Branch' : 'Graph'}</span>
        </button>
        <span class="scm-mode-toggle" title="Show all commits, or only this branch's commits since a base">
          <button class={`scm-mode-btn${mode === 'commits' ? ' active' : ''}`} onClick={() => { setMode('commits'); setGraphOpen(true) }}>Commits</button>
          <button class={`scm-mode-btn${mode === 'branch' ? ' active' : ''}`} onClick={() => { setMode('branch'); setGraphOpen(true) }}>Branch</button>
        </span>
      </div>
      {graphOpen && mode === 'branch' && (
        <div class="scm-branch-bar">
          <label class="scm-base-label" title="Base ref: commits and changes are shown relative to this branch">
            <span>vs</span>
            <select class="scm-base-select" value={base ?? ''} onChange={(e) => chooseBase((e.currentTarget as HTMLSelectElement).value)} disabled={branches.length === 0}>
              {branches.length === 0 && <option value="">no other branches</option>}
              {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </label>
          <button class="scm-review-btn" disabled={!base} title="Review every change on this branch since it diverged from the base" onClick={() => { if (base) onOpenBranchReview(base) }}>
            <GitCompareArrows size={13} /> Review changes
          </button>
        </div>
      )}
      {graphOpen && (
        <div class="scm-graph" ref={graphRef} onScroll={onGraphScroll}>
          {mode === 'branch' && commits.length === 0 && <div class="scm-empty-row">{base ? `No commits ahead of ${base}` : 'No base branch to compare against'}</div>}
          {commits.map((commit) => {
            const isOpen = expanded.has(commit.hash)
            const files = commitFiles[commit.hash]
            return (
              <div key={commit.hash} class="scm-commit">
                <div
                  class="scm-commit-row"
                  onClick={() => onOpenReview(commit)}
                  onContextMenu={(e) => { e.preventDefault(); setCommitMenu({ commit, x: e.clientX, y: e.clientY }) }}
                >
                  <button
                    class="scm-commit-toggle"
                    title={isOpen ? 'Hide files' : 'Show files'}
                    onClick={(e) => { e.stopPropagation(); void toggleCommit(commit.hash) }}
                  >
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <div class="scm-commit-body">
                    <div class="scm-commit-subject" title={commit.subject}>{commit.subject}</div>
                    <div class="scm-commit-meta">
                      <span class="scm-commit-hash">{commit.short}</span>
                      <span class="scm-commit-author">{commit.author}</span>
                      <span class="scm-commit-age" title={new Date(commit.date).toLocaleString()}>{relativeTime(commit.date)}</span>
                      {(commit.added > 0 || commit.deleted > 0) && (
                        <span class="scm-commit-stats">
                          {commit.added > 0 && <span class="review-stat-add">+{commit.added}</span>}
                          {commit.deleted > 0 && <span class="review-stat-del">−{commit.deleted}</span>}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isOpen && files && files.map((f) => (
                  <div
                    key={f.path}
                    class="scm-commit-file"
                    title={f.path}
                    onClick={() => onOpenDiff({ mode: 'commit', file: f.path, hash: commit.hash }, `${basename(f.path)} (${commit.short})`)}
                    onContextMenu={(e) => openFileMenu(e, f.path, f.status)}
                  >
                    <span class="scm-file-name">{basename(f.path)}</span>
                    <span class="scm-file-dir">{dirname(f.path)}</span>
                    <span class={`scm-badge badge-${f.status}`}>{f.status}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {loadingMore && <div class="scm-empty-row">Loading…</div>}
        </div>
      )}

      {commitMenu && (() => {
        const c = commitMenu.commit
        const entries: MenuEntry[] = [
          { kind: 'item', label: 'Open Review', onClick: () => onOpenReview(c) },
          { kind: 'item', label: expanded.has(c.hash) ? 'Hide Files' : 'Show Files', onClick: () => void toggleCommit(c.hash) },
          { kind: 'separator' },
          { kind: 'item', label: 'Copy Hash', onClick: () => void navigator.clipboard.writeText(c.hash) },
          { kind: 'item', label: 'Copy Short Hash', onClick: () => void navigator.clipboard.writeText(c.short) },
          { kind: 'item', label: 'Copy Subject', onClick: () => void navigator.clipboard.writeText(c.subject) },
        ]
        return <ContextMenu x={commitMenu.x} y={commitMenu.y} entries={entries} onClose={() => setCommitMenu(null)} />
      })()}
      {fileMenu && (() => {
        const abs = rootPath ? `${rootPath}/${fileMenu.path}` : fileMenu.path
        const entries: MenuEntry[] = [
          { kind: 'item', label: 'Open File', disabled: fileMenu.deleted, onClick: () => onOpenFile(fileMenu.path) },
          { kind: 'item', label: 'Reveal in Explorer', disabled: fileMenu.deleted, onClick: () => onRevealInExplorer(fileMenu.path) },
          { kind: 'separator' },
          { kind: 'item', label: 'Copy Path', onClick: () => void navigator.clipboard.writeText(abs) },
          { kind: 'item', label: 'Copy Relative Path', onClick: () => void navigator.clipboard.writeText(fileMenu.path) },
          { kind: 'separator' },
          { kind: 'item', label: 'File History', onClick: () => onOpenHistory(fileMenu.path) },
        ]
        return <ContextMenu x={fileMenu.x} y={fileMenu.y} entries={entries} onClose={() => setFileMenu(null)} />
      })()}
    </div>
  )
}
