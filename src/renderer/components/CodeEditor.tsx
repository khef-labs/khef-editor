import { useEffect, useRef } from 'preact/hooks'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import { languageForFilename } from '../lib/language'
import { editorThemeExtension } from '../lib/editorTheme'
import type { EditorThemeKey } from '../lib/themes'

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
          '.cm-scroller': { fontFamily: "'SF Mono', ui-monospace, Menlo, monospace" },
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
