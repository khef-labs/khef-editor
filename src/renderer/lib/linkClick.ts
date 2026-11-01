// Cmd+click (Ctrl+click off macOS) opens the link under the pointer:
// - an http(s) URL opens in the default browser
// - an absolute or ~/ file path (optionally :line[:col]) opens in the editor
// While the modifier is held over a link, it is underlined and the pointer becomes a hand,
// like VS Code.
//
// URLs go through window.open: the main process's setWindowOpenHandler passes http(s)
// URLs to shell.openExternal and denies everything else, so no new IPC is needed.
// Paths go to a handler App registers with setPathOpener (module-level, so the handler
// doesn't have to be threaded through every pane down to each CodeEditor). App sends the
// raw path to main, which decides what may be opened.

import { StateEffect, StateField, Prec, type Extension } from '@codemirror/state'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { urlAt } from './urlAt'
import { pathAt } from './pathAt'

type Link =
  | { kind: 'url'; url: string }
  | { kind: 'path'; path: string; line?: number; col?: number }
type DocSpan = { from: number; to: number; link: Link }

export type PathOpener = (path: string, line?: number, col?: number) => void
let pathOpener: PathOpener | null = null
/** Register (or clear with null) the handler Cmd+click calls for file paths. */
export function setPathOpener(fn: PathOpener | null): void {
  pathOpener = fn
}

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

/** The link at viewport coordinates, in document offsets. URLs win over paths. */
function linkAtCoords(view: EditorView, x: number, y: number): DocSpan | null {
  const pos = view.posAtCoords({ x, y })
  if (pos == null) return null
  const line = view.state.doc.lineAt(pos)
  const col = pos - line.from
  let from: number
  let to: number
  let link: Link
  const url = urlAt(line.text, col)
  if (url) {
    ({ from, to } = url)
    link = { kind: 'url', url: url.url }
  } else {
    // Paths only open in the app, so skip them when nothing is registered to open them.
    const p = pathOpener ? pathAt(line.text, col) : null
    if (!p) return null
    ;({ from, to } = p)
    link = { kind: 'path', path: p.path, line: p.line, col: p.col }
  }
  // posAtCoords snaps to the nearest character, so a click in the empty space after a
  // line that ends with a link still lands on it. Require the pointer to be over the text.
  const end = view.coordsAtPos(line.from + to, -1)
  if (end && x > end.right + 1 && y >= end.top && y <= end.bottom) return null
  return { from: line.from + from, to: line.from + to, link }
}

function setHover(view: EditorView, next: DocSpan | null) {
  const cur = view.state.field(hoverField)
  if (cur === next || (cur && next && cur.from === next.from && cur.to === next.to)) return
  view.dispatch({ effects: setHoverLink.of(next) })
}

function openLink(link: Link) {
  if (link.kind === 'url') window.open(link.url, '_blank', 'noopener')
  else pathOpener?.(link.path, link.line, link.col)
}

export function linkClick(): Extension {
  let lastX = -1
  let lastY = -1
  const refresh = (view: EditorView, mod: boolean) => {
    setHover(view, mod && lastX >= 0 ? linkAtCoords(view, lastX, lastY) : null)
  }

  return [
    hoverField,
    // High precedence so a Cmd+click on a link wins over CodeMirror's Cmd+click
    // "add cursor". A Cmd+click anywhere else still adds a cursor as before.
    Prec.high(EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !modHeld(e) || e.shiftKey || e.altKey) return false
        const hit = linkAtCoords(view, e.clientX, e.clientY)
        if (!hit) return false
        e.preventDefault()
        setHover(view, null)
        openLink(hit.link)
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
