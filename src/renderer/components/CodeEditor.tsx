import { useEffect, useRef } from 'preact/hooks'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
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

  // Build the view once.
  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
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
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
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
    return () => {
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
