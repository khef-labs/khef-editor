import { applyEdits, format, parseTree, printParseErrorCode, type ParseError } from 'jsonc-parser'

export function formatJson(source: string): string {
  const formatted = JSON.stringify(JSON.parse(source), null, 2)
  return formatted + (source.endsWith('\n') ? '\n' : '')
}

export function formatJsonc(source: string): string {
  const errors: ParseError[] = []
  const tree = parseTree(source, errors, { allowTrailingComma: true })
  if (!tree || errors.length > 0) {
    const first = errors[0]
    throw new SyntaxError(first ? `${printParseErrorCode(first.error)} at offset ${first.offset}` : 'Expected a JSONC value')
  }
  return applyEdits(source, format(source, undefined, {
    insertSpaces: true,
    tabSize: 2,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
    insertFinalNewline: source.endsWith('\n'),
  }))
}
