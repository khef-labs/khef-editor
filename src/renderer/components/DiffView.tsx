import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { computeDiff, toUnifiedRows, type DiffRow, type DiffRowKind } from '../lib/diff'

export interface DiffSpec {
  mode: 'working' | 'commit'
  file: string
  hash?: string
}

interface DiffViewProps {
  spec: DiffSpec
}

export type DiffViewMode = 'split' | 'unified'

// Remembered across diff tabs within the session; seeded from settings on first mount
// and persisted on change.
let sessionDiffMode: DiffViewMode | null = null

// A contiguous run of changed rows, marked on the overview ruler.
interface DiffHunk {
  start: number
  len: number
  kind: DiffRowKind
}

// Read-only diff with two layouts, toggled in the header and remembered in settings:
//  - split: aligned old|new row PAIRS (long lines soft-wrap on either side without the
//    sides drifting out of alignment)
//  - unified: single column, GitHub hunk order (removals before additions)
// An overview ruler on the right marks changed regions; clicking it jumps there.
export function DiffView({ spec }: DiffViewProps) {
  const [rows, setRows] = useState<DiffRow[] | null>(null)
  const [labels, setLabels] = useState<{ old: string; new: string }>({ old: '', new: '' })
  const [error, setError] = useState<string | null>(null)
  const [mode, setModeState] = useState<DiffViewMode>(sessionDiffMode ?? 'split')
  const bodyRef = useRef<HTMLDivElement>(null)

  // First mount of the session: adopt the persisted preference.
  useEffect(() => {
    if (sessionDiffMode != null) return
    window.editorApi.getSettings().then((s) => {
      if (sessionDiffMode == null && (s.diffMode === 'unified' || s.diffMode === 'split')) {
        sessionDiffMode = s.diffMode
        setModeState(s.diffMode)
      }
    }).catch(() => {})
  }, [])

  const setMode = (m: DiffViewMode) => {
    sessionDiffMode = m
    setModeState(m)
    void window.editorApi.setSettings({ diffMode: m }).catch(() => {})
  }

  useEffect(() => {
    let cancelled = false
    setRows(null); setError(null)
    window.editorApi.git.fileDiff(spec).then((d) => {
      if (cancelled) return
      setLabels({ old: d.oldLabel, new: d.newLabel })
      setRows(computeDiff(d.oldText, d.newText))
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => { cancelled = true }
  }, [spec.mode, spec.file, spec.hash])

  const unified = useMemo(() => (rows && mode === 'unified' ? toUnifiedRows(rows) : null), [rows, mode])
  // Rows as displayed — one ruler marker / jump index per rendered row, in either mode.
  const displayKinds = useMemo<DiffRowKind[]>(() => {
    if (unified) return unified.map((r) => r.kind)
    return rows ? rows.map((r) => r.kind) : []
  }, [rows, unified])

  // Contiguous same-kind runs of changed rows, for the ruler markers.
  const hunks = useMemo<DiffHunk[]>(() => {
    const out: DiffHunk[] = []
    for (let i = 0; i < displayKinds.length; i++) {
      const kind = displayKinds[i]
      if (kind === 'same') continue
      const last = out[out.length - 1]
      if (last && last.kind === kind && last.start + last.len === i) last.len++
      else out.push({ start: i, len: 1, kind })
    }
    return out
  }, [displayKinds])

  const rowCount = displayKinds.length

  const jumpToRow = (index: number) => {
    const body = bodyRef.current
    if (!body || rowCount === 0) return
    const row = body.children[Math.max(0, Math.min(index, rowCount - 1))]
    row?.scrollIntoView({ block: 'center' })
  }

  // Click anywhere on the ruler: map the click's vertical position to a row index and
  // jump there. Marker clicks land on the right hunk because markers sit at the same
  // proportional position the mapping produces.
  const onRulerClick = (e: MouseEvent) => {
    if (rowCount === 0) return
    const track = e.currentTarget as HTMLElement
    const rect = track.getBoundingClientRect()
    const frac = (e.clientY - rect.top) / rect.height
    jumpToRow(Math.floor(frac * rowCount))
  }

  if (error) return <div class="diff-view"><div class="diff-error">{error}</div></div>
  if (!rows) return <div class="diff-view"><div class="diff-loading">Loading diff…</div></div>

  return (
    <div class="diff-view" data-testid="diff-view">
      <div class="diff-header">
        {mode === 'split' ? (
          <>
            <span class="diff-side-label">{labels.old}</span>
            <span class="diff-side-label">{labels.new}</span>
          </>
        ) : (
          <span class="diff-side-label">{labels.old} → {labels.new}</span>
        )}
        <span class="diff-mode-toggle">
          <button class={`diff-mode-btn${mode === 'split' ? ' active' : ''}`} onClick={() => setMode('split')}>Split</button>
          <button class={`diff-mode-btn${mode === 'unified' ? ' active' : ''}`} onClick={() => setMode('unified')}>Unified</button>
        </span>
      </div>
      <div class="diff-main">
        <div class="diff-body" ref={bodyRef}>
          {unified
            ? unified.map((r, i) => (
                <div key={i} class={`diff-urow diff-${r.kind}`}>
                  <span class="diff-num">{r.oldNum ?? ''}</span>
                  <span class="diff-num">{r.newNum ?? ''}</span>
                  <span class="diff-sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span>
                  <span class="diff-text">{r.text}</span>
                </div>
              ))
            : rows.map((r, i) => (
                <div key={i} class="diff-pair">
                  <div class={`diff-cell diff-${r.kind === 'add' ? 'empty' : r.kind}`}>
                    <span class="diff-num">{r.oldNum ?? ''}</span>
                    <span class="diff-text">{r.oldText ?? ''}</span>
                  </div>
                  <div class={`diff-cell diff-${r.kind === 'del' ? 'empty' : r.kind}`}>
                    <span class="diff-num">{r.newNum ?? ''}</span>
                    <span class="diff-text">{r.newText ?? ''}</span>
                  </div>
                </div>
              ))}
        </div>
        <div class="diff-ruler" onClick={onRulerClick} title="Click to jump to a change">
          {hunks.map((h, i) => (
            <div
              key={i}
              class={`diff-marker diff-marker-${h.kind}`}
              style={{
                top: `${(h.start / rowCount) * 100}%`,
                height: `max(${(h.len / rowCount) * 100}%, 3px)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
