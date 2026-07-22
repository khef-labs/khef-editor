import type { Extension } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'

// Map a filename to a CodeMirror language extension. Returns [] for plain text.
// This is the synchronous fast path for the grammars bundled into the main chunk;
// anything it misses may still resolve via loadLanguageForFilename below.
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
    case '.jsonc':
      return [json()]
    case '.md':
    case '.mdx':
    case '.markdown':
      // codeLanguages makes fenced code blocks highlight in their own language,
      // lazy-loading each grammar on first use.
      return [markdown({ codeLanguages: languages })]
    case '.css':
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

// Extensions the registry doesn't match on its own, mapped to the registry
// language name that fits them best.
const registryAliases: Record<string, string> = {
  '.zsh': 'Shell',
  '.env': 'Properties files',
  '.conf': 'Properties files',
}

// Async fallback: match the filename against the full language-data registry
// (Go, Rust, Java, C/C++, shell, YAML, TOML, SQL, XML, and ~140 more). Grammars
// are code-split and dynamically imported on first use, then cached by the
// LanguageDescription itself. Returns null when nothing matches (plain text).
export async function loadLanguageForFilename(name: string): Promise<Extension[] | null> {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const alias = registryAliases[ext]
  const desc = alias
    ? languages.find((d) => d.name === alias)
    : LanguageDescription.matchFilename(languages, name)
  if (!desc) return null
  const support = await desc.load()
  return [support]
}
