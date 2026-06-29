import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'

// Map a filename to a CodeMirror language extension. Returns [] for plain text.
export function languageForFilename(name: string): Extension[] {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.tsx':
      return [javascript({ typescript: true, jsx: ext === '.tsx' })]
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return [javascript({ jsx: ext === '.jsx' })]
    case '.json':
      return [json()]
    case '.md':
    case '.mdx':
    case '.markdown':
      return [markdown()]
    case '.css':
    case '.scss':
    case '.less':
      return [css()]
    case '.html':
    case '.htm':
    case '.vue':
    case '.svelte':
      return [html()]
    case '.py':
      return [python()]
    default:
      return []
  }
}
