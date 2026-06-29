import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks'
import type { FileListEntry } from '../../../electron/types'
import { fuzzyMatch } from '../lib/fuzzy'

interface QuickOpenProps {
  onPick: (entry: FileListEntry) => void
  onClose: () => void
}

const MAX_RESULTS = 50

export function QuickOpen({ onPick, onClose }: QuickOpenProps) {
  const [files, setFiles] = useState<FileListEntry[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load the file corpus once on open.
  useEffect(() => {
    let cancelled = false
    window.editorApi.listFiles().then((res) => {
      if (!cancelled) setFiles(res.files)
    }).catch(() => { if (!cancelled) setFiles([]) })
    inputRef.current?.focus()
    return () => { cancelled = true }
  }, [])

  const results = useMemo(() => {
    if (!query) {
      // No query → show first N files by path.
      return files.slice(0, MAX_RESULTS).map((f) => ({ entry: f, positions: [] as number[] }))
    }
    const scored: { entry: FileListEntry; score: number; positions: number[] }[] = []
    for (const f of files) {
      const m = fuzzyMatch(query, f.rel)
      if (m) scored.push({ entry: f, score: m.score, positions: m.positions })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, MAX_RESULTS)
  }, [query, files])

  // Clamp selection when results change.
  useEffect(() => { setSelected(0) }, [query])

  const choose = useCallback((idx: number) => {
    const r = results[idx]
    if (r) onPick(r.entry)
  }, [results, onPick])

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(selected) }
  }, [results.length, selected, choose, onClose])

  return (
    <div class="qo-backdrop" onMouseDown={onClose}>
      <div class="qo-panel" onMouseDown={(e) => e.stopPropagation()} data-testid="quickopen">
        <input
          ref={inputRef}
          class="qo-input"
          placeholder="Search files by name…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
        />
        <ul class="qo-results">
          {results.length === 0 && <li class="qo-empty">No matching files</li>}
          {results.map((r, idx) => {
            const set = new Set(r.positions)
            const rel = r.entry.rel
            const slash = rel.lastIndexOf('/')
            return (
              <li
                key={r.entry.path}
                class={`qo-item${idx === selected ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(idx)}
                onClick={() => choose(idx)}
                data-testid={`qo-item-${r.entry.name}`}
              >
                <span class="qo-name">
                  {rel.slice(slash + 1).split('').map((ch, i) => {
                    const abs = slash + 1 + i
                    return set.has(abs) ? <b key={i}>{ch}</b> : ch
                  })}
                </span>
                {slash >= 0 && (
                  <span class="qo-dir">
                    {rel.slice(0, slash).split('').map((ch, i) => (set.has(i) ? <b key={i}>{ch}</b> : ch))}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
