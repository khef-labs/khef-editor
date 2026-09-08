import { useEffect, useState, useCallback } from 'preact/hooks'
import { FileText, GitCommitHorizontal } from 'lucide-preact'
import type { GitCommit } from '../../../electron/types'
import { relativeTime } from '../lib/relativeTime'
import type { DiffSpec } from './DiffView'

interface FileHistoryViewProps {
  // Repo-relative path whose history is shown.
  file: string
  onOpenDiff: (spec: DiffSpec, title: string) => void
  onOpenReview: (commit: GitCommit) => void
  onOpenFile: (relPath: string) => void
}

const PAGE = 100

function basename(p: string): string { return p.split('/').pop() ?? p }

// Every commit that touched one file (following renames), newest first. Clicking a row
// opens that commit's diff of the file; the review button opens the whole commit.
export function FileHistoryView({ file, onOpenDiff, onOpenReview, onOpenFile }: FileHistoryViewProps) {
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    setCommits(null); setError(null)
    window.editorApi.git.fileHistory(file, 0, PAGE).then((r) => {
      if (cancelled) return
      setCommits(r.commits); setHasMore(r.hasMore)
    }).catch((e) => {
      const m = e instanceof Error ? e.message : String(e)
      if (!cancelled) setError(m.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''))
    })
    return () => { cancelled = true }
  }, [file])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !commits) return
    setLoadingMore(true)
    try {
      const r = await window.editorApi.git.fileHistory(file, commits.length, PAGE)
      setCommits((prev) => [...(prev ?? []), ...r.commits]); setHasMore(r.hasMore)
    } finally { setLoadingMore(false) }
  }, [loadingMore, hasMore, commits, file])

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLDivElement
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) void loadMore()
  }

  return (
    <div class="history-view" onScroll={onScroll} data-testid="history-view">
      <div class="review-header">
        <div class="review-title-row">
          <span class="review-hash review-hash-static"><GitCommitHorizontal size={12} /> History</span>
          <span class="review-subject" title={file}>{file}</span>
          <span class="review-actions">
            <button class="scm-tool" title="Open file" onClick={() => onOpenFile(file)}><FileText size={15} /></button>
          </span>
        </div>
        {commits && (
          <div class="review-meta">
            <span>{commits.length}{hasMore ? '+' : ''} {commits.length === 1 ? 'commit' : 'commits'}</span>
          </div>
        )}
      </div>
      {error && <div class="diff-error">{error}</div>}
      {!commits && !error && <div class="diff-loading">Loading history…</div>}
      {commits && commits.length === 0 && <div class="review-card-note">No commits touch this file.</div>}
      <div class="history-list">
        {commits?.map((c) => (
          <div
            key={c.hash}
            class="history-row"
            title={`Open ${basename(file)} as of ${c.short}`}
            onClick={() => onOpenDiff({ mode: 'commit', file, hash: c.hash }, `${basename(file)} (${c.short})`)}
          >
            <div class="history-row-main">
              <div class="scm-commit-subject">{c.subject}</div>
              <div class="scm-commit-meta">
                <span class="scm-commit-hash">{c.short}</span>
                <span class="scm-commit-author">{c.author}</span>
                <span class="scm-commit-age" title={new Date(c.date).toLocaleString()}>{relativeTime(c.date)}</span>
                {(c.added > 0 || c.deleted > 0) && (
                  <span class="scm-commit-stats">
                    {c.added > 0 && <span class="review-stat-add">+{c.added}</span>}
                    {c.deleted > 0 && <span class="review-stat-del">−{c.deleted}</span>}
                  </span>
                )}
              </div>
            </div>
            <button class="history-review-btn" title="Open the whole commit as a review" onClick={(e) => { e.stopPropagation(); onOpenReview(c) }}>Review</button>
          </div>
        ))}
        {loadingMore && <div class="scm-empty-row">Loading…</div>}
      </div>
    </div>
  )
}
