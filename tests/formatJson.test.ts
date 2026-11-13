import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatJson, formatJsonc } from '../src/renderer/lib/formatJson.ts'

test('formats nested JSON and preserves trailing newline', () => {
  assert.equal(formatJson('{"a":{"b":[1,true]}}\n'), '{\n  "a": {\n    "b": [\n      1,\n      true\n    ]\n  }\n}\n')
})

test('rejects invalid JSON without producing output', () => {
  assert.throws(() => formatJson('{"a":}'), SyntaxError)
})

test('formats JSONC while keeping comments and trailing commas', () => {
  const source = '{// leading\n"a":1, // inline\n"b":[2,],\n}\n'
  const output = formatJsonc(source)
  assert.match(output, /\/\/ leading/)
  assert.match(output, /\/\/ inline/)
  assert.match(output, /2,\s*\]/)
  assert.match(output, /\],\s*\}/)
  assert.match(output, /"a": 1/)
  assert.equal(output.endsWith('\n'), true)
})

test('keeps CRLF and rejects malformed JSONC', () => {
  const output = formatJsonc('{"a":1,}\r\n')
  assert.equal(output, '{\r\n  "a": 1,\r\n}\r\n')
  assert.equal(formatJsonc('{"a":1,}'), '{\n  "a": 1,\n}')
  assert.throws(() => formatJsonc('{"a":,}'), SyntaxError)
})
