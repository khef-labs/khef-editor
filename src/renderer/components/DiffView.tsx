import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { computeDiff, type DiffRow, type DiffRowKind } from '../lib/diff'

export interface DiffSpec {
  mode: 'working' | 'commit'
  file: string
  hash?: string
}

interface DiffViewProps {
  spec: DiffSpec
}

// A contiguous run of changed rows, marked on the overview ruler.
interface DiffHunk {
  start: number
  len: number
  kind: DiffRowKind
}

// Read-only side-by-side diff. Fetches old/new file text from the git IPC and renders
// aligned row PAIRS (old | new cells in one flex row), so long lines can soft-wrap on
// either side without the two sides drifting out of alignment. An overview ruler on the
// right marks changed regions across the whole file; clicking it jumps to that spot.
export function DiffView({ spec }: DiffViewProps) {
  const [rows, setRows] = useState<DiffRow[] | null>(null)
  const [labels, setLabels] = useState<{ old: string; new: string }>({ old: '', new: '' })
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

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

  // Contiguous same-kind runs of changed rows, for the ruler markers.
  const hunks = useMemo<DiffHunk[]>(() => {
    if (!rows) return []
    const out: DiffHunk[] = []
    for (let i = 0; i < rows.length; i++) {
      const kind = rows[i].kind
      if (kind === 'same') continue
      const last = out[out.length - 1]
      if (last && last.kind === kind && last.start + last.len === i) last.len++
      else out.push({ start: i, len: 1, kind })
    }
    return out
  }, [rows])

  const jumpToRow = (index: number) => {
    const body = bodyRef.current
    if (!body || !rows) return
    const row = body.children[Math.max(0, Math.min(index, rows.length - 1))]
    row?.scrollIntoView({ block: 'center' })
  }

  // Click anywhere on the ruler: map the click's vertical position to a row index and
  // jump there. Marker clicks land on the right hunk because markers sit at the same
  // proportional position the mapping produces.
  const onRulerClick = (e: MouseEvent) => {
    if (!rows || rows.length === 0) return
    const track = e.currentTarget as HTMLElement
    const rect = track.getBoundingClientRect()
    const frac = (e.clientY - rect.top) / rect.height
    jumpToRow(Math.floor(frac * rows.length))
  }

  if (error) return <div class="diff-view"><div class="diff-error">{error}</div></div>
  if (!rows) return <div class="diff-view"><div class="diff-loading">Loading diff…</div></div>

  return (
    <div class="diff-view" data-testid="diff-view">
      <div class="diff-header">
        <span class="diff-side-label">{labels.old}</span>
        <span class="diff-side-label">{labels.new}</span>
      </div>
      <div class="diff-main">
        <div class="diff-body" ref={bodyRef}>
          {rows.map((r, i) => (
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
                top: `${(h.start / rows.length) * 100}%`,
                height: `max(${(h.len / rows.length) * 100}%, 3px)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
