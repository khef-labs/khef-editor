import { useEffect, useState } from 'preact/hooks'
import { computeDiff, type DiffRow } from '../lib/diff'

export interface DiffSpec {
  mode: 'working' | 'commit'
  file: string
  hash?: string
}

interface DiffViewProps {
  spec: DiffSpec
}

// Read-only side-by-side diff. Fetches old/new file text from the git IPC and renders
// two aligned gutters + columns (old | new) with per-row add/del/mod coloring.
export function DiffView({ spec }: DiffViewProps) {
  const [rows, setRows] = useState<DiffRow[] | null>(null)
  const [labels, setLabels] = useState<{ old: string; new: string }>({ old: '', new: '' })
  const [error, setError] = useState<string | null>(null)

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

  if (error) return <div class="diff-view"><div class="diff-error">{error}</div></div>
  if (!rows) return <div class="diff-view"><div class="diff-loading">Loading diff…</div></div>

  return (
    <div class="diff-view" data-testid="diff-view">
      <div class="diff-header">
        <span class="diff-side-label">{labels.old}</span>
        <span class="diff-side-label">{labels.new}</span>
      </div>
      <div class="diff-body">
        <div class="diff-col diff-old">
          {rows.map((r, i) => (
            <div key={i} class={`diff-row diff-${r.kind === 'add' ? 'empty' : r.kind}`}>
              <span class="diff-num">{r.oldNum ?? ''}</span>
              <span class="diff-text">{r.oldText ?? ''}</span>
            </div>
          ))}
        </div>
        <div class="diff-col diff-new">
          {rows.map((r, i) => (
            <div key={i} class={`diff-row diff-${r.kind === 'del' ? 'empty' : r.kind}`}>
              <span class="diff-num">{r.newNum ?? ''}</span>
              <span class="diff-text">{r.newText ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
