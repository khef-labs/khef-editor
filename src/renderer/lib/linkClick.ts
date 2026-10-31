// Cmd+click (Ctrl+click off macOS) opens an http(s) URL under the pointer in the default
// browser. While the modifier is held over a URL, the URL is underlined and the pointer
// becomes a hand, like VS Code.
//
// Opening goes through window.open: the main process's setWindowOpenHandler passes http(s)
// URLs to shell.openExternal and denies everything else, so no new IPC is needed.

import { StateEffect, StateField, Prec, type Extension } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { urlAt } from './urlAt'

type DocSpan = { from: number; to: number; url: string }

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const modHeld = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey)

const setHoverLink = StateEffect.define<DocSpan | null>()
const hoverMark = Decoration.mark({ class: 'cm-link-hover' })

const hoverField = StateField.define<DocSpan | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHoverLink)) value = e.value
    // Any edit invalidates the offsets; the next mouse move recomputes them.
    if (value && tr.docChanged) value = null
    return value
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v): DecorationSet =>
      v ? Decoration.set([hoverMark.range(v.from, v.to)]) : Decoration.none),
    EditorView.editorAttributes.from(f, (v): Record<string, string> => (v ? { class: 'cm-link-hovering' } : {})),
  ],
})

/** The URL at viewport coordinates, in document offsets. */
function linkAtCoords(view: EditorView, x: number, y: number): DocSpan | null {
  const pos = view.posAtCoords({ x, y })
  if (pos == null) return null
  const line = view.state.doc.lineAt(pos)
  const span = urlAt(line.text, pos - line.from)
  if (!span) return null
  // posAtCoords snaps to the nearest character, so a click in the empty space after a
  // line that ends with a URL still lands on it. Require the pointer to be over the text.
  const end = view.coordsAtPos(line.from + span.to, -1)
  if (end && x > end.right + 1 && y >= end.top && y <= end.bottom) return null
  return { from: line.from + span.from, to: line.from + span.to, url: span.url }
}

function setHover(view: EditorView, next: DocSpan | null) {
  const cur = view.state.field(hoverField)
  if (cur === next || (cur && next && cur.from === next.from && cur.to === next.to)) return
  view.dispatch({ effects: setHoverLink.of(next) })
}

export function linkClick(): Extension {
  let lastX = -1
  let lastY = -1
  const refresh = (view: EditorView, mod: boolean) => {
    setHover(view, mod && lastX >= 0 ? linkAtCoords(view, lastX, lastY) : null)
  }

  return [
    hoverField,
    // High precedence so a Cmd+click on a URL wins over CodeMirror's Cmd+click
    // "add cursor". A Cmd+click anywhere else still adds a cursor as before.
    Prec.high(EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !modHeld(e) || e.shiftKey || e.altKey) return false
        const link = linkAtCoords(view, e.clientX, e.clientY)
        if (!link) return false
        e.preventDefault()
        window.open(link.url, '_blank', 'noopener')
        return true
      },
      mousemove(e, view) {
        lastX = e.clientX
        lastY = e.clientY
        refresh(view, modHeld(e))
        return false
      },
      mouseleave(_e, view) {
        lastX = lastY = -1
        setHover(view, null)
        return false
      },
      keydown(e, view) {
        if (e.key === 'Meta' || e.key === 'Control') refresh(view, modHeld(e))
        return false
      },
      keyup(e, view) {
        if (e.key === 'Meta' || e.key === 'Control') refresh(view, modHeld(e))
        return false
      },
      blur(_e, view) {
        setHover(view, null)
        return false
      },
    })),
    EditorView.baseTheme({
      '.cm-link-hover': { textDecoration: 'underline', textUnderlineOffset: '2px' },
      '&.cm-link-hovering .cm-content': { cursor: 'pointer' },
    }),
  ]
}
