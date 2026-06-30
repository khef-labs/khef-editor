import { useEffect, useRef, useState, useCallback } from 'preact/hooks'
import { ChevronRight, ChevronDown, RefreshCw, GitBranch } from 'lucide-preact'
import type { GitChange, GitCommit } from '../../../electron/types'
import type { DiffSpec } from './DiffView'

interface SourceControlPanelProps {
  // Re-fetch trigger: bump to refresh (e.g. when the panel becomes visible or a file saves).
  refreshToken: number
  onOpenDiff: (spec: DiffSpec, title: string) => void
}

const PAGE = 50
const badgeTitle: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', U: 'Untracked' }

function basename(p: string): string { return p.split('/').pop() ?? p }
function dirname(p: string): string { const b = basename(p); return p.slice(0, p.length - b.length - 1) }

export function SourceControlPanel({ refreshToken, onOpenDiff }: SourceControlPanelProps) {
  const [isRepo, setIsRepo] = useState<boolean | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [changes, setChanges] = useState<GitChange[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [changesOpen, setChangesOpen] = useState(true)
  const [graphOpen, setGraphOpen] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [commitFiles, setCommitFiles] = useState<Record<string, GitChange[]>>({})
  const graphRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const info = await window.editorApi.git.info()
      setIsRepo(info.isRepo)
      setBranch(info.branch)
      if (!info.isRepo) { setChanges([]); setCommits([]); return }
      const [st, log] = await Promise.all([
        window.editorApi.git.status(),
        window.editorApi.git.log(0, PAGE),
      ])
      setChanges(st.files)
      setCommits(log.commits)
      setHasMore(log.hasMore)
    } catch {
      setIsRepo(false)
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshToken])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const log = await window.editorApi.git.log(commits.length, PAGE)
      setCommits((prev) => [...prev, ...log.commits])
      setHasMore(log.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, commits.length])

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

      {/* CHANGES */}
      <button class="scm-section-header" onClick={() => setChangesOpen((v) => !v)}>
        {changesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Changes</span>
        {changes.length > 0 && <span class="scm-count">{changes.length}</span>}
      </button>
      {changesOpen && (
        <div class="scm-list">
          {changes.length === 0 && <div class="scm-empty-row">No changes</div>}
          {changes.map((c) => (
            <div
              key={c.path}
              class="scm-file-row"
              title={c.path}
              onClick={() => onOpenDiff({ mode: 'working', file: c.path }, `${basename(c.path)} (Working Tree)`)}
            >
              <span class="scm-file-name">{basename(c.path)}</span>
              <span class="scm-file-dir">{dirname(c.path)}</span>
              <span class={`scm-badge badge-${c.status}`} title={badgeTitle[c.status] ?? c.status}>{c.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* GRAPH (commit history, infinite scroll) */}
      <button class="scm-section-header" onClick={() => setGraphOpen((v) => !v)}>
        {graphOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Graph</span>
      </button>
      {graphOpen && (
        <div class="scm-graph" ref={graphRef} onScroll={onGraphScroll}>
          {commits.map((commit) => {
            const isOpen = expanded.has(commit.hash)
            const files = commitFiles[commit.hash]
            return (
              <div key={commit.hash} class="scm-commit">
                <div class="scm-commit-row" onClick={() => void toggleCommit(commit.hash)}>
                  <span class="scm-commit-dot" />
                  <span class="scm-commit-subject" title={`${commit.short} · ${commit.author} · ${commit.date}`}>{commit.subject}</span>
                </div>
                {isOpen && files && files.map((f) => (
                  <div
                    key={f.path}
                    class="scm-commit-file"
                    title={f.path}
                    onClick={() => onOpenDiff({ mode: 'commit', file: f.path, hash: commit.hash }, `${basename(f.path)} (${commit.short})`)}
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
    </div>
  )
}
