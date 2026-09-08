import { useEffect, useRef, useState } from 'preact/hooks'
import { mountDiff, type DiffLayout, type DiffHandle } from '../lib/diffMount'
import { noteRef } from '../lib/reviewNotes'
import { useDiffNotes } from './useDiffNotes'
import type { EditorThemeKey } from '../lib/themes'

export interface DiffSpec {
  // 'range': hash is the merge-base (old side), new side is HEAD.
  mode: 'working' | 'staged' | 'commit' | 'range'
  file: string
  hash?: string
}

interface DiffViewProps {
  spec: DiffSpec
  themeKey: EditorThemeKey
}

export type DiffViewMode = DiffLayout

// Remembered across diff tabs within the session; seeded from settings on first mount
// and persisted on change.
let sessionDiffMode: DiffViewMode | null = null

// Read-only diff on CodeMirror's merge package, so a diff gets the same syntax colours and
// theme as the editor, word-level change marks, and folded unchanged regions. Two layouts,
// toggled in the header and remembered in settings:
//  - split: old | new side by side (MergeView; chunks stay aligned, long lines soft-wrap)
//  - unified: one column, deletions inline above insertions (unifiedMergeView)
export function DiffView({ spec, themeKey }: DiffViewProps) {
  const [texts, setTexts] = useState<{ old: string; new: string } | null>(null)
  const [labels, setLabels] = useState<{ old: string; new: string }>({ old: '', new: '' })
  const [error, setError] = useState<string | null>(null)
  const [mode, setModeState] = useState<DiffViewMode>(sessionDiffMode ?? 'split')
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<DiffHandle | null>(null)
  const { notesOptions, pushNotes, menuEl, count: noteCount } = useDiffNotes(noteRef(spec), spec.file, handleRef)

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
    setTexts(null); setError(null)
    window.editorApi.git.fileDiff(spec).then((d) => {
      if (cancelled) return
      setLabels({ old: d.oldLabel, new: d.newLabel })
      setTexts({ old: d.oldText, new: d.newText })
    }).catch((e) => {
      const m = e instanceof Error ? e.message : String(e)
      if (!cancelled) setError(m.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''))
    })
    return () => { cancelled = true }
  }, [spec.mode, spec.file, spec.hash])

  // Mount the CodeMirror view for the current texts/mode/theme; rebuilt from scratch when
  // any of them change (cheap — the views are read-only and hold no user state).
  useEffect(() => {
    const host = hostRef.current
    if (!host || !texts) return
    const h = mountDiff(host, {
      oldText: texts.old, newText: texts.new,
      filename: spec.file.split('/').pop() ?? spec.file,
      layout: mode, themeKey, notes: notesOptions,
    })
    handleRef.current = h
    pushNotes(h)
    return () => { handleRef.current = null; h.destroy() }
  }, [texts, mode, themeKey, spec.file, notesOptions, pushNotes])

  if (error) return <div class="diff-view"><div class="diff-error">{error}</div></div>

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
        {noteCount > 0 && <span class="diff-note-count" title="Review notes on this diff (right-click a line to add one)">{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>}
        <span class="diff-mode-toggle">
          <button class={`diff-mode-btn${mode === 'split' ? ' active' : ''}`} onClick={() => setMode('split')}>Split</button>
          <button class={`diff-mode-btn${mode === 'unified' ? ' active' : ''}`} onClick={() => setMode('unified')}>Unified</button>
        </span>
      </div>
      {!texts && <div class="diff-loading">Loading diff…</div>}
      <div class={`diff-host diff-tints${mode === 'split' ? ' diff-host-split' : ''}`} ref={hostRef} />
      {menuEl}
    </div>
  )
}
