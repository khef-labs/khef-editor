import { useEffect, useRef } from 'preact/hooks'
import { EditorState, Compartment, EditorSelection, Prec } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
  cursorCharForward, cursorCharBackward, cursorLineUp, cursorLineDown,
  cursorLineStart, cursorLineEnd, cursorDocStart, cursorDocEnd,
  cursorGroupForward, cursorGroupBackward,
  selectCharForward, selectCharBackward, selectLineUp, selectLineDown,
  selectLineStart, selectLineEnd, selectGroupForward, selectGroupBackward,
} from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import { languageForFilename } from '../lib/language'
import { editorThemeExtension } from '../lib/editorTheme'
import type { EditorThemeKey } from '../lib/themes'

// Overview-ruler cursor marker: a small tick on the editor's right edge showing where
// the cursor line sits within the whole document (VS Code's scrollbar cursor marker).
const cursorOverviewMarker = ViewPlugin.fromClass(
  class {
    marker: HTMLDivElement
    view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.marker = document.createElement('div')
      this.marker.className = 'cm-cursor-overview'
      // Appended to .cm-editor (does not scroll) so the tick stays fixed to the viewport
      // right edge at the cursor row's on-screen Y.
      view.dom.appendChild(this.marker)
      // Defer the first placement until after the view has been measured.
      view.requestMeasure({ read: () => this.reposition(view) })
    }
    update(update: ViewUpdate) {
      // Reposition on cursor move, edits, and any geometry/viewport change (scrolling).
      this.reposition(update.view)
    }
    reposition(view: EditorView) {
      // VS Code's overview-ruler cursor marker is ALWAYS document-relative: it sits in the
      // scrollbar lane at (cursorLine / totalLines) of the editor height, regardless of
      // where the viewport is scrolled. It does not track the cursor's on-screen row.
      const head = view.state.selection.main.head
      const totalLines = view.state.doc.lines
      const cursorLine = view.state.doc.lineAt(head).number
      const frac = totalLines > 1 ? (cursorLine - 1) / (totalLines - 1) : 0
      const trackH = view.dom.clientHeight
      const top = Math.round(frac * (trackH - 3))
      this.marker.style.display = 'block'
      this.marker.style.top = `${top}px`
    }
    destroy() {
      this.marker.remove()
    }
  },
  {
    // coordsAtPos is viewport-relative, so reposition on scroll too.
    eventHandlers: {
      scroll() {
        const self = this as unknown as { reposition(v: EditorView): void; view?: EditorView }
        if (self.view) self.reposition(self.view)
      },
    },
  },
)

interface CodeEditorProps {
  // Identity of the open doc. When this changes, the document is replaced.
  path: string
  filename: string
  value: string
  themeKey: EditorThemeKey
  // A jump request: { line, token } — bump `token` to re-trigger a jump to the same line.
  gotoLine?: { line: number; token: number } | null
  onChange: (value: string) => void
  onSave: () => void
}

type CMCommand = (view: EditorView) => boolean

// Emacs kill ring — shared across all editors (like Emacs), mirroring khef's editor.
let killRing = ''

// The most-recently-focused editor view, so app-level chords (e.g. C-x h select-all)
// can target the active editor.
let activeEditorView: EditorView | null = null

export function selectAllInActiveEditor(): boolean {
  const view = activeEditorView
  if (!view) return false
  view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) })
  view.focus()
  return true
}

export function CodeEditor({ path, filename, value, themeKey, gotoLine, onChange, onSave }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageComp = useRef(new Compartment())
  const themeComp = useRef(new Compartment())
  // Keep latest callbacks without rebuilding the view.
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  // Emacs "mark" (set with C-Space): when active, motion commands extend the selection.
  const markActiveRef = useRef(false)

  // Build the Emacs keybinding extension. Mirrors khef's editor: mark + region, kill ring
  // (C-k / C-w / C-y), open line (C-o), readline motion (C-f/b/p/n/a/e), word motion
  // (M-f/b), and document jumps (M-< / M->). Movement extends the selection when the mark
  // is active. Word/doc motion lives in domEventHandlers because macOS Option transforms
  // the typed character, breaking CM6 keymap matching (event.code is stable).
  const buildEmacsExtension = () => {
    const clearMark = (view?: EditorView | null) => {
      markActiveRef.current = false
      if (!view) return
      const { main } = view.state.selection
      if (!main.empty) view.dispatch({ selection: EditorSelection.cursor(main.head) })
    }
    const setMark = (view: EditorView) => {
      markActiveRef.current = true
      view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) })
      return true
    }
    const motion = (move: CMCommand, selectMove: CMCommand): CMCommand =>
      (view) => (markActiveRef.current ? selectMove(view) : move(view))

    return Prec.highest(keymap.of([
      { key: 'Ctrl-Space', preventDefault: true, run: setMark },
      { key: 'Ctrl-g', run: (view) => {
          if (!markActiveRef.current && view.state.selection.main.empty) return false
          clearMark(view); return true
        } },
      { key: 'Ctrl-p', preventDefault: true, run: motion(cursorLineUp, selectLineUp) },
      { key: 'Ctrl-n', preventDefault: true, run: motion(cursorLineDown, selectLineDown) },
      { key: 'Ctrl-f', preventDefault: true, run: motion(cursorCharForward, selectCharForward) },
      { key: 'Ctrl-b', preventDefault: true, run: motion(cursorCharBackward, selectCharBackward) },
      { key: 'Ctrl-a', preventDefault: true, run: motion(cursorLineStart, selectLineStart) },
      { key: 'Ctrl-e', preventDefault: true, run: motion(cursorLineEnd, selectLineEnd) },
      { key: 'Ctrl-d', preventDefault: true, run: (view) => {
          const { head } = view.state.selection.main
          if (head >= view.state.doc.length) return false
          view.dispatch({ changes: { from: head, to: head + 1 } }); return true
        } },
      { key: 'Ctrl-k', preventDefault: true, run: (view) => {
          const { head } = view.state.selection.main
          const line = view.state.doc.lineAt(head)
          const to = head >= line.to ? Math.min(line.to + 1, view.state.doc.length) : line.to
          if (head === to) return false
          killRing = view.state.sliceDoc(head, to)
          view.dispatch({ changes: { from: head, to } })
          markActiveRef.current = false
          navigator.clipboard.writeText(killRing).catch(() => {})
          return true
        } },
      { key: 'Ctrl-w', preventDefault: true, run: (view) => {
          const { main } = view.state.selection
          if (main.empty) return false
          killRing = view.state.sliceDoc(main.from, main.to)
          view.dispatch({ changes: { from: main.from, to: main.to }, selection: EditorSelection.cursor(main.from) })
          markActiveRef.current = false
          navigator.clipboard.writeText(killRing).catch(() => {})
          return true
        } },
      { key: 'Alt-w', preventDefault: true, run: (view) => {
          const { main } = view.state.selection
          if (main.empty) return false
          killRing = view.state.sliceDoc(main.from, main.to)
          navigator.clipboard.writeText(killRing).catch(() => {})
          clearMark(view)
          return true
        } },
      { key: 'Ctrl-y', preventDefault: true, run: (view) => {
          if (!killRing) return false
          const { main } = view.state.selection
          view.dispatch({
            changes: { from: main.from, to: main.to, insert: killRing },
            selection: EditorSelection.cursor(main.from + killRing.length),
          })
          return true
        } },
      { key: 'Ctrl-o', preventDefault: true, run: (view) => {
          const { head } = view.state.selection.main
          const line = view.state.doc.lineAt(head)
          view.dispatch({ changes: { from: line.from, insert: '\n' }, selection: EditorSelection.cursor(line.from) })
          return true
        } },
      { key: 'Ctrl-z', preventDefault: true, run: (view) => undo(view) },
      { key: 'Ctrl-Shift-z', preventDefault: true, run: (view) => redo(view) },
    ]))
  }

  // Word/doc motion via DOM events (macOS Option transforms event.key; event.code is stable).
  const emacsDomHandlers = () => EditorView.domEventHandlers({
    keydown: (ev, view) => {
      const event = ev as KeyboardEvent
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.code === 'KeyF' || event.code === 'KeyB') {
          event.preventDefault()
          const fwd = event.code === 'KeyF'
          if (markActiveRef.current) (fwd ? selectGroupForward : selectGroupBackward)(view)
          else (fwd ? cursorGroupForward : cursorGroupBackward)(view)
          return true
        }
        if (event.shiftKey && (event.code === 'Comma' || event.code === 'Period')) {
          event.preventDefault()
          const toStart = event.code === 'Comma'
          if (markActiveRef.current) {
            const anchor = view.state.selection.main.anchor
            view.dispatch({ selection: EditorSelection.range(anchor, toStart ? 0 : view.state.doc.length), scrollIntoView: true })
          } else {
            (toStart ? cursorDocStart : cursorDocEnd)(view)
          }
          return true
        }
      }
      return false
    },
    mousedown: (_e, view) => { markActiveRef.current = false; activeEditorView = view; return false },
    focusin: (_e, view) => { activeEditorView = view; return false },
  })

  // Build the view once.
  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        buildEmacsExtension(),
        emacsDomHandlers(),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        cursorOverviewMarker,
        EditorView.lineWrapping,
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        keymap.of([
          { key: 'Mod-s', run: () => { onSaveRef.current(); return true } },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
        ]),
        languageComp.current.of(languageForFilename(filename)),
        themeComp.current.of(editorThemeExtension(themeKey)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) { markActiveRef.current = false; onChangeRef.current(u.state.doc.toString()) }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': {
            fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
            overflow: 'auto',
          },
          // Force a persistent (non-overlay) scrollbar. Styling ::-webkit-scrollbar with
          // an explicit width + non-overlay appearance keeps it from fading like the macOS
          // overlay scrollbar. Do NOT also set scrollbar-color — that re-enables overlay.
          '.cm-scroller::-webkit-scrollbar': {
            width: '14px',
            height: '14px',
            WebkitAppearance: 'none',
          },
          '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
          '.cm-scroller::-webkit-scrollbar-thumb': {
            background: 'var(--scrollbar-thumb)',
            borderRadius: '7px',
            border: '3px solid transparent',
            backgroundClip: 'content-box',
            minHeight: '40px',
          },
          '.cm-scroller::-webkit-scrollbar-thumb:hover': {
            background: 'var(--scrollbar-thumb-hover)',
            backgroundClip: 'content-box',
          },
          // Active-line highlight. !important is required to beat the package theme's own
          // .cm-activeLine rule (e.g. oneDark's faint #6699ff0b), which otherwise wins on
          // specificity despite this being declared later.
          '.cm-activeLine': { backgroundColor: 'var(--active-line) !important' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--active-line) !important' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    activeEditorView = view
    return () => {
      if (activeEditorView === view) activeEditorView = null
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When the open file changes (path), swap document + language.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        effects: languageComp.current.reconfigure(languageForFilename(filename)),
      })
    } else {
      view.dispatch({ effects: languageComp.current.reconfigure(languageForFilename(filename)) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Sync external value changes (e.g. revert-to-saved) that arrive without a path change.
  // When the user types, onChange flows the same text back as `value`, so it already
  // matches the doc and this no-ops — only genuine external changes replace the doc.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Reconfigure the editor theme live when the app theme changes.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: themeComp.current.reconfigure(editorThemeExtension(themeKey)) })
  }, [themeKey])

  // Jump to a line (1-based) when a search result is clicked. The token lets the same
  // line re-trigger a jump.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !gotoLine) return
    const lineNo = Math.max(1, Math.min(gotoLine.line, view.state.doc.lines))
    const lineInfo = view.state.doc.line(lineNo)
    view.dispatch({
      selection: { anchor: lineInfo.from },
      effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
    })
    view.focus()
  }, [gotoLine?.token])

  return <div class="cm-host" ref={hostRef} />
}
