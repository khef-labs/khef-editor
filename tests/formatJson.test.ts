import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatJson } from '../src/renderer/lib/formatJson.ts'

test('formats nested JSON and preserves trailing newline', () => {
  assert.equal(formatJson('{"a":{"b":[1,true]}}\n'), '{\n  "a": {\n    "b": [\n      1,\n      true\n    ]\n  }\n}\n')
})

test('rejects invalid JSON without producing output', () => {
  assert.throws(() => formatJson('{"a":}'), SyntaxError)
})
