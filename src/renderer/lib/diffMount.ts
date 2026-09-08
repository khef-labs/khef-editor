// Mount a read-only CodeMirror diff (split MergeView or unified view) into a host element.
// Shared by the diff tab (fills its host, scrolls inside) and review-page file cards
// (`fill: false` — the editor grows to its content and the page scrolls). Optionally wires
// review notes: a per-side line context menu callback plus inline note widgets.

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { diffEditorSetup, applyAsyncLanguage } from './mergeExtensions'
import { hybridDiff } from './hybridDiff'
import { reviewNotesExtension, setNotesEffect, openComposerEffect, type NoteHandlers } from './noteWidgets'
import type { ReviewNote } from './reviewNotes'
import type { EditorThemeKey } from './themes'

export type DiffLayout = 'split' | 'unified'
export type DiffSide = 'old' | 'new'

export interface DiffNotesOptions {
  handlers: (side: DiffSide) => NoteHandlers
  // Right-click on a line of one side.
  onLineContextMenu: (side: DiffSide, line: number, x: number, y: number) => void
}

export interface DiffMountOptions {
  oldText: string
  newText: string
  filename: string
  layout: DiffLayout
  themeKey: EditorThemeKey
  // Default true: the editor fills the host and scrolls. False: auto height, no inner scroll.
  fill?: boolean
  notes?: DiffNotesOptions
}

export interface DiffHandle {
  destroy: () => void
  // Push the current note list for one side (unified mode only has 'new').
  setNotes: (side: DiffSide, notes: ReviewNote[]) => void
  openComposer: (side: DiffSide, line: number) => void
}

// Unchanged stretches fold away to keep the eye on the change; a click on the fold bar
// expands it. Same numbers as the merge package defaults, spelled out so they're visible.
const COLLAPSE = { margin: 3, minSize: 4 }
// Line-first diff (see hybridDiff.ts) — the package's char-level Myers gives up on big files.
const DIFF_CONFIG = { override: hybridDiff }

const autoHeight = EditorView.theme({
  '&': { height: 'auto' },
  '.cm-scroller': { overflow: 'visible' },
})

function noteExtensions(o: DiffMountOptions, side: DiffSide) {
  if (!o.notes) return []
  const { handlers, onLineContextMenu } = o.notes
  return [
    reviewNotesExtension(handlers(side)),
    EditorView.domEventHandlers({
      contextmenu(e, view) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos == null) return false
        e.preventDefault()
        onLineContextMenu(side, view.state.doc.lineAt(pos).number, e.clientX, e.clientY)
        return true
      },
    }),
  ]
}

// Language grammars outside the main chunk load lazily and are swapped in only while the
// view is still mounted.
export function mountDiff(host: HTMLElement, o: DiffMountOptions): DiffHandle {
  let alive = true
  const isAlive = () => alive
  const extra = o.fill === false ? [autoHeight] : []
  const views: Partial<Record<DiffSide, EditorView>> = {}
  let destroy: () => void

  if (o.layout === 'split') {
    const a = diffEditorSetup(o.filename, o.themeKey)
    const b = diffEditorSetup(o.filename, o.themeKey)
    const mv = new MergeView({
      a: { doc: o.oldText, extensions: [...a.extensions, ...extra, ...noteExtensions(o, 'old')] },
      b: { doc: o.newText, extensions: [...b.extensions, ...extra, ...noteExtensions(o, 'new')] },
      parent: host,
      collapseUnchanged: COLLAPSE,
      highlightChanges: true,
      gutter: true,
      diffConfig: DIFF_CONFIG,
    })
    applyAsyncLanguage(mv.a, a, o.filename, isAlive)
    applyAsyncLanguage(mv.b, b, o.filename, isAlive)
    views.old = mv.a
    views.new = mv.b
    destroy = () => mv.destroy()
  } else {
    const setup = diffEditorSetup(o.filename, o.themeKey)
    const view = new EditorView({
      state: EditorState.create({
        doc: o.newText,
        extensions: [
          ...setup.extensions,
          ...extra,
          ...noteExtensions(o, 'new'),
          unifiedMergeView({
            original: o.oldText,
            mergeControls: false,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: COLLAPSE,
            diffConfig: DIFF_CONFIG,
          }),
        ],
      }),
      parent: host,
    })
    applyAsyncLanguage(view, setup, o.filename, isAlive)
    views.new = view
    destroy = () => view.destroy()
  }

  return {
    destroy: () => { alive = false; destroy() },
    setNotes: (side, notes) => { if (alive && o.notes) views[side]?.dispatch({ effects: setNotesEffect.of(notes) }) },
    openComposer: (side, line) => { if (alive && o.notes) views[side]?.dispatch({ effects: openComposerEffect.of(line) }) },
  }
}
