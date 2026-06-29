import { useEffect, useRef } from 'preact/hooks'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { languageForFilename } from '../lib/language'

interface CodeEditorProps {
  // Identity of the open doc. When this changes, the document is replaced.
  path: string
  filename: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
}

export function CodeEditor({ path, filename, value, onChange, onSave }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageComp = useRef(new Compartment())
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
        oneDark,
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

  return <div class="cm-host" ref={hostRef} />
}
