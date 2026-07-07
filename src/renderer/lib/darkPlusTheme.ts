// A CodeMirror 6 theme approximating VS Code's built-in "Dark+" (default dark) theme —
// the editor background, gutter, selection, and Lezer syntax colors. The bundled CM themes
// (one-dark, monokai, …) don't match VS Code, so this brings the editor content area in line
// with the rest of the Dark+ chrome. Colors are VS Code's Dark+ token values.

import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

// Editor palette — from Roger's exported VS Code dark theme (vs-code-dark.json).
const bg = '#121314'
const fg = '#bbbebf'
const caret = '#bbbebf'
const selection = '#276782dd'
const selectionMatch = '#27678260'
const gutterFg = '#858889'
const gutterActiveFg = '#bbbebf'

// Dark+ syntax colors.
const blue = '#569cd6'        // keywords, storage
const lightBlue = '#9cdcfe'   // identifiers, variables, properties
const teal = '#4ec9b0'        // types, classes, interfaces
const yellow = '#dcdcaa'      // functions, method calls
const orange = '#ce9178'      // strings
const numberOrange = '#b5cea8' // numbers, constants
const purple = '#c586c0'      // control keywords (if/return/import)
const green = '#6a9955'       // comments
const regexp = '#d16969'
const tagBlue = '#569cd6'
const attrLightBlue = '#9cdcfe'

const darkPlusHighlight = HighlightStyle.define([
  { tag: t.keyword, color: blue },
  { tag: [t.controlKeyword, t.moduleKeyword], color: purple },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: lightBlue },
  { tag: [t.propertyName], color: lightBlue },
  { tag: [t.variableName], color: lightBlue },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: yellow },
  { tag: [t.labelName], color: yellow },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: numberOrange },
  { tag: [t.definition(t.name), t.separator], color: fg },
  { tag: [t.typeName, t.className, t.namespace], color: teal },
  { tag: [t.number, t.integer, t.float, t.bool, t.null], color: numberOrange },
  { tag: [t.operator, t.operatorKeyword], color: fg },
  { tag: [t.escape, t.regexp, t.special(t.string)], color: regexp },
  { tag: [t.meta, t.comment], color: green, fontStyle: 'italic' },
  { tag: [t.lineComment, t.blockComment, t.docComment], color: green, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: lightBlue, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: blue },
  { tag: [t.string, t.processingInstruction, t.inserted], color: orange },
  { tag: [t.atom, t.self], color: blue },
  { tag: [t.tagName], color: tagBlue },
  { tag: [t.attributeName], color: attrLightBlue },
  { tag: [t.angleBracket, t.bracket, t.brace, t.punctuation], color: fg },
  { tag: t.invalid, color: '#f44747' },
])

const darkPlusView = EditorView.theme(
  {
    '&': { color: fg, backgroundColor: bg },
    '.cm-content': { caretColor: caret },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: caret },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: selection },
    '.cm-selectionMatch': { backgroundColor: selectionMatch },
    '.cm-searchMatch': { backgroundColor: '#27678280', outline: '1px solid #3994bc99' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#27678290' },
    '.cm-panels': { backgroundColor: '#202122', color: fg },
    '.cm-gutters': { backgroundColor: bg, color: gutterFg, border: 'none' },
    '.cm-activeLineGutter': { color: gutterActiveFg, backgroundColor: 'transparent' },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: '#808080' },
    '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: '#3994bc55', outline: '1px solid #2a2b2c' },
  },
  { dark: true },
)

export const darkPlus: Extension = [darkPlusView, syntaxHighlighting(darkPlusHighlight)]
