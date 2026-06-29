import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { githubLight, githubDark } from '@uiw/codemirror-theme-github'
import { monokai } from '@uiw/codemirror-theme-monokai'
import { solarizedDark } from '@uiw/codemirror-theme-solarized'
import type { EditorThemeKey } from './themes'

// Resolve a theme key to a CodeMirror theme extension.
export function editorThemeExtension(key: EditorThemeKey): Extension {
  switch (key) {
    case 'light':
      return githubLight
    case 'monokai':
      return monokai
    case 'solarized-dark':
      return solarizedDark
    case 'github-dark':
      return githubDark
    case 'one-dark':
    default:
      return oneDark
  }
}
