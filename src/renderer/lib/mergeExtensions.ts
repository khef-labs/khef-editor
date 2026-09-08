// Extensions shared by every read-only diff editor (the split MergeView's two sides and the
// unified view). Kept out of DiffView so commit/branch review cards can build identical
// editors. The language is wrapped in a Compartment so grammars that live outside the main
// chunk (Go, Rust, YAML, …) can be swapped in once they load — see applyAsyncLanguage.

import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers, highlightSpecialChars } from '@codemirror/view'
import { languageForFilename, loadLanguageForFilename } from './language'
import { editorThemeExtension } from './editorTheme'
import type { EditorThemeKey } from './themes'

export interface DiffEditorSetup {
  extensions: Extension[]
  language: Compartment
}

// Matches the main editor's metrics (CodeEditor.tsx) so a diff reads like the file it came
// from: same font, same 13px/19px line grid. Height 100% lets the unified view scroll inside
// its host; the split MergeView overrides it (the outer .cm-mergeView scrolls instead).
const diffBaseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': {
    fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
    lineHeight: '19px',
    overflow: 'auto',
  },
  '.cm-gutters': { userSelect: 'none' },
  // A read-only editor still shows a caret on click; hide it so the diff reads as a document.
  '.cm-cursor, .cm-dropCursor': { display: 'none !important' },
})

export function diffEditorSetup(filename: string, themeKey: EditorThemeKey): DiffEditorSetup {
  const language = new Compartment()
  const extensions: Extension[] = [
    lineNumbers(),
    highlightSpecialChars(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    language.of(languageForFilename(filename)),
    editorThemeExtension(themeKey),
    diffBaseTheme,
  ]
  return { extensions, language }
}

// When the synchronous grammar lookup found nothing, try the lazy registry and reconfigure
// the view's language compartment once it resolves. `alive` lets a caller that has since
// destroyed the view veto the dispatch (dispatching into a destroyed view throws).
export function applyAsyncLanguage(view: EditorView, setup: DiffEditorSetup, filename: string, alive: () => boolean): void {
  if (languageForFilename(filename).length > 0) return
  void loadLanguageForFilename(filename).then((ext) => {
    if (!ext || !alive()) return
    view.dispatch({ effects: setup.language.reconfigure(ext) })
  }).catch(() => {})
}
