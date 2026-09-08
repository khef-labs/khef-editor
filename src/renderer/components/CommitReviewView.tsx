import { useEffect, useRef, useState, useCallback, useMemo } from 'preact/hooks'
import { ChevronRight, ChevronDown, Copy, Check, FileText, ChevronsDownUp, ChevronsUpDown, GitBranch } from 'lucide-preact'
import type { GitReviewFile } from '../../../electron/types'
import type { EditorThemeKey } from '../lib/themes'
import { mountDiff, type DiffLayout, type DiffHandle } from '../lib/diffMount'
import { noteRef } from '../lib/reviewNotes'
import { useDiffNotes } from './useDiffNotes'
import { relativeTime } from '../lib/relativeTime'
import { parseCommitBody, splitInlineCode, type CommitBlock } from '../lib/commitMessage'
import type { DiffSpec } from './DiffView'

// What a review tab shows: one commit, or the current branch against a base ref.
export type ReviewSpec =
  | { kind: 'commit'; hash: string; title: string }
  | { kind: 'range'; base: string; title: string }

interface CommitReviewViewProps {
  spec: ReviewSpec
  themeKey: EditorThemeKey
  // Open the working-tree file (repo-relative path) as an editor tab.
  onOpenFile: (relPath: string) => void
}

// Normalized page model for either spec kind.
interface ReviewModel {
  hash: string | null      // full commit hash (commit) or merge-base (range)
  short: string
  subject: string
  metaLeft: string          // author (commit) or "N commits since <base>" (range)
  date: string | null
  body: string
  files: GitReviewFile[]
  added: number
  deleted: number
  // How each file's diff is fetched.
  diffFor: (file: string) => DiffSpec
}

// Electron wraps IPC errors as "Error invoking remote method 'x': Error: …"; show only the message.
function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

const badgeTitle: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed' }
function basename(p: string): string { return p.split('/').pop() ?? p }
function dirname(p: string): string { const b = basename(p); return p.slice(0, p.length - b.length - 1) }

// Review pages default to unified (deletions inline above insertions — the GitHub/khef
// layout); remembered for the session, independent of the diff tab's setting.
let sessionReviewLayout: DiffLayout = 'unified'

async function loadModel(spec: ReviewSpec): Promise<ReviewModel> {
  if (spec.kind === 'commit') {
    const d = await window.editorApi.git.commitDetail(spec.hash)
    return {
      hash: d.hash, short: d.short, subject: d.subject, metaLeft: d.author, date: d.date, body: d.body,
      files: d.files, added: d.added, deleted: d.deleted,
      diffFor: (file) => ({ mode: 'commit', file, hash: d.hash }),
    }
  }
  const r = await window.editorApi.git.rangeDetail(spec.base)
  return {
    hash: r.mergeBase, short: r.mergeBase.slice(0, 7),
    subject: `Changes since ${spec.base}`,
    metaLeft: `${r.commits} ${r.commits === 1 ? 'commit' : 'commits'} ahead of ${spec.base}`,
    date: null, body: '',
    files: r.files, added: r.added, deleted: r.deleted,
    diffFor: (file) => ({ mode: 'range', file, hash: r.mergeBase }),
  }
}

// One commit (or a branch range) as a review page: header (hash, subject, author, age,
// counts), the commit body, then every changed file stacked as a collapsible card.
export function CommitReviewView({ spec, themeKey, onOpenFile }: CommitReviewViewProps) {
  const [model, setModel] = useState<ReviewModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [layout, setLayoutState] = useState<DiffLayout>(sessionReviewLayout)
  const [copied, setCopied] = useState(false)
  const specKey = spec.kind === 'commit' ? `commit:${spec.hash}` : `range:${spec.base}`

  useEffect(() => {
    let cancelled = false
    setModel(null); setError(null); setCollapsed(new Set())
    loadModel(spec).then((m) => { if (!cancelled) setModel(m) }).catch((e) => {
      if (!cancelled) setError(errorMessage(e))
    })
    return () => { cancelled = true }
  }, [specKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const setLayout = (l: DiffLayout) => { sessionReviewLayout = l; setLayoutState(l) }

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }, [])

  const copyHash = () => {
    if (!model?.hash) return
    void navigator.clipboard.writeText(model.hash).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  if (error) return <div class="review-view"><div class="diff-error">{error}</div></div>
  if (!model) return <div class="review-view"><div class="diff-loading">Loading…</div></div>

  const allCollapsed = model.files.length > 0 && model.files.every((f) => collapsed.has(f.path))
  const isRange = spec.kind === 'range'

  return (
    <div class="review-view" data-testid="review-view">
      <div class="review-header">
        <div class="review-title-row">
          {isRange ? (
            <span class="review-hash review-hash-static" title={`Merge base ${model.hash ?? ''}`}><GitBranch size={12} /> {spec.base}…HEAD</span>
          ) : (
            <button class="review-hash" title={copied ? 'Copied' : `Copy ${model.hash ?? ''}`} onClick={copyHash}>
              {model.short} {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          )}
          <span class="review-subject">{model.subject}</span>
          <span class="review-actions">
            <button
              class="scm-tool"
              title={allCollapsed ? 'Expand all files' : 'Collapse all files'}
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(model.files.map((f) => f.path)))}
            >
              {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
            </button>
            <span class="diff-mode-toggle">
              <button class={`diff-mode-btn${layout === 'split' ? ' active' : ''}`} onClick={() => setLayout('split')}>Split</button>
              <button class={`diff-mode-btn${layout === 'unified' ? ' active' : ''}`} onClick={() => setLayout('unified')}>Unified</button>
            </span>
          </span>
        </div>
        <div class="review-meta">
          <span>{model.metaLeft}</span>
          {model.date && (
            <>
              <span class="review-meta-sep">·</span>
              <span title={new Date(model.date).toLocaleString()}>{relativeTime(model.date)}</span>
            </>
          )}
          <span class="review-meta-sep">·</span>
          <span>{model.files.length} {model.files.length === 1 ? 'file' : 'files'}</span>
          <span class="review-stat-add">+{model.added}</span>
          <span class="review-stat-del">−{model.deleted}</span>
        </div>
        {model.body && <CommitMessage body={model.body} />}
      </div>
      <div class="review-files">
        {model.files.length === 0 && <div class="review-card-note">No changes.</div>}
        {model.files.map((f) => (
          <ReviewFileCard
            key={f.path}
            file={f}
            diffSpec={model.diffFor(f.path)}
            layout={layout}
            themeKey={themeKey}
            collapsed={collapsed.has(f.path)}
            onToggle={() => toggle(f.path)}
            onOpenFile={f.status === 'D' ? undefined : () => onOpenFile(f.path)}
          />
        ))}
      </div>
    </div>
  )
}

// Inline `code` spans inside prose.
function prose(text: string) {
  return splitInlineCode(text).map((seg, i) => (i % 2 === 1 ? <code key={i} class="review-inline-code">{seg}</code> : seg))
}

function Block({ block }: { block: CommitBlock }) {
  if (block.kind === 'code') return <pre class="review-code">{block.text}</pre>
  if (block.kind === 'list') {
    const items = block.items.map((it, i) => <li key={i}>{prose(it)}</li>)
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
  }
  return <p>{prose(block.text)}</p>
}

// The commit body as prose: reflowed paragraphs, real lists, verbatim code, and the
// trailer block (Session, Co-authored-by, …) as key/value chips. Long bodies start
// collapsed with a "Show more" control.
function CommitMessage({ body }: { body: string }) {
  const parsed = useMemo(() => parseCommitBody(body), [body])
  const long = body.split('\n').length > 10 || body.length > 900
  const [expanded, setExpanded] = useState(false)
  if (parsed.blocks.length === 0 && parsed.trailers.length === 0) return null
  return (
    <div class="review-message">
      {parsed.blocks.length > 0 && (
        <div class={`review-message-body${long && !expanded ? ' collapsed' : ''}`}>
          {parsed.blocks.map((b, i) => <Block key={i} block={b} />)}
        </div>
      )}
      {long && (
        <button class="review-message-more" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'Show more'}</button>
      )}
      {parsed.trailers.length > 0 && (
        <div class="review-trailers">
          {parsed.trailers.map((t, i) => (
            <span key={i} class="review-trailer" title={`${t.key}: ${t.value}`}>
              <span class="review-trailer-key">{t.key}</span>
              <span class="review-trailer-value">{t.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

interface ReviewFileCardProps {
  file: GitReviewFile
  diffSpec: DiffSpec
  layout: DiffLayout
  themeKey: EditorThemeKey
  collapsed: boolean
  onToggle: () => void
  onOpenFile?: () => void
}

// A file in a review: header row (chevron, status, path, counts, open) and, when expanded
// and scrolled near the viewport, its diff. The diff is fetched and mounted lazily so a
// 40-file commit doesn't build 40 editors up front.
export function ReviewFileCard({ file, diffSpec, layout, themeKey, collapsed, onToggle, onOpenFile }: ReviewFileCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [texts, setTexts] = useState<{ old: string; new: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<DiffHandle | null>(null)
  const { notesOptions, pushNotes, menuEl, count: noteCount } = useDiffNotes(noteRef(diffSpec), file.path, handleRef)

  // Near-viewport detection (600px lookahead) — flips once and stays.
  useEffect(() => {
    const el = cardRef.current
    if (!el || near) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect() }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  useEffect(() => {
    if (!near || collapsed || texts || file.binary) return
    let cancelled = false
    window.editorApi.git.fileDiff(diffSpec).then((d) => {
      if (!cancelled) setTexts({ old: d.oldText, new: d.newText })
    }).catch((e) => { if (!cancelled) setError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [near, collapsed, texts, file.binary, diffSpec.mode, diffSpec.file, diffSpec.hash])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !texts || collapsed) return
    const h = mountDiff(host, {
      oldText: texts.old, newText: texts.new, filename: basename(file.path), layout, themeKey, fill: false, notes: notesOptions,
    })
    handleRef.current = h
    pushNotes(h)
    return () => { handleRef.current = null; h.destroy() }
  }, [texts, collapsed, layout, themeKey, file.path, notesOptions, pushNotes])

  return (
    <div class="review-card" ref={cardRef} data-testid="review-card">
      <div class="review-card-header" onClick={onToggle}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span class={`scm-badge badge-${file.status}`} title={badgeTitle[file.status] ?? file.status}>{file.status}</span>
        <span class="review-card-path" title={file.path}>
          {dirname(file.path) && <span class="review-card-dir">{dirname(file.path)}/</span>}
          <span class="review-card-name">{basename(file.path)}</span>
          {file.oldPath && <span class="review-card-dir"> ← {file.oldPath}</span>}
        </span>
        {noteCount > 0 && <span class="diff-note-count">{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>}
        {file.binary
          ? <span class="review-card-binary">binary</span>
          : <span class="review-card-stats"><span class="review-stat-add">+{file.added}</span><span class="review-stat-del">−{file.deleted}</span></span>}
        {onOpenFile && (
          <button class="scm-tool" title="Open file" onClick={(e) => { e.stopPropagation(); onOpenFile() }}><FileText size={14} /></button>
        )}
      </div>
      {!collapsed && (
        <div class="review-card-body">
          {file.binary && <div class="review-card-note">Binary file not shown</div>}
          {error && <div class="diff-error">{error}</div>}
          {!file.binary && !error && !texts && <div class="review-card-note">Loading…</div>}
          <div class={`review-diff-host diff-tints${layout === 'split' ? ' diff-host-split' : ''}`} ref={hostRef} />
        </div>
      )}
      {menuEl}
    </div>
  )
}
