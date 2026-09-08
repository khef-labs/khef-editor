import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hybridDiff, lineStarts } from '../src/renderer/lib/hybridDiff.ts'

// Rebuild `b` from `a` plus the changes — the one property every diff must satisfy.
function apply(a: string, b: string, changes: readonly { fromA: number; toA: number; fromB: number; toB: number }[]): string {
  let out = ''
  let posA = 0
  for (const c of changes) {
    assert.ok(c.fromA >= posA, 'changes must be ordered and non-overlapping')
    out += a.slice(posA, c.fromA) + b.slice(c.fromB, c.toB)
    posA = c.toA
  }
  return out + a.slice(posA)
}

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n') + '\n'

test('lineStarts: offsets plus a text.length sentinel; newline belongs to its line', () => {
  assert.deepEqual(lineStarts('ab\ncd\n'), [0, 3, 6, 6])
  assert.deepEqual(lineStarts('ab\ncd'), [0, 3, 5])
  assert.deepEqual(lineStarts(''), [0, 0])
})

test('identical inputs produce no changes', () => {
  assert.deepEqual(hybridDiff('a\nb\n', 'a\nb\n'), [])
})

test('one edited line in a large file stays a small, local change', () => {
  const a = lines(6000)
  const b = a.replace('line 4321\n', 'line 4321 changed\n')
  const changes = hybridDiff(a, b)
  assert.equal(apply(a, b, changes), b)
  assert.equal(changes.length, 1)
  const c = changes[0]
  // The change sits inside line 4321 (character refinement), not across the whole file.
  const starts = lineStarts(a)
  assert.ok(c.fromA >= starts[4321] && c.toA <= starts[4322], `change ${c.fromA}-${c.toA} outside line 4321`)
  assert.ok(c.toA - c.fromA < 20)
})

test('many scattered edits in a large file reconstruct exactly', () => {
  const a = lines(8000)
  let b = a
  for (const n of [10, 777, 1500, 2999, 4000, 5555, 6001, 7999]) b = b.replace(`line ${n}\n`, `line ${n} v2\n`)
  const changes = hybridDiff(a, b)
  assert.equal(apply(a, b, changes), b)
  assert.equal(changes.length, 8)
})

test('pure insertions and deletions of whole lines', () => {
  const a = lines(50)
  const inserted = a.replace('line 25\n', 'line 25\nnew A\nnew B\n')
  const deleted = a.replace('line 10\nline 11\n', '')
  for (const b of [inserted, deleted]) {
    const changes = hybridDiff(a, b)
    assert.equal(apply(a, b, changes), b)
    assert.equal(changes.length, 1)
  }
})

test('files without a trailing newline and empty sides', () => {
  assert.equal(apply('a\nb', 'a\nb\nc', hybridDiff('a\nb', 'a\nb\nc')), 'a\nb\nc')
  assert.equal(apply('', 'x\ny\n', hybridDiff('', 'x\ny\n')), 'x\ny\n')
  assert.equal(apply('x\ny\n', '', hybridDiff('x\ny\n', '')), '')
})

test('a wholesale rewrite still reconstructs', () => {
  const a = lines(3000, 'old')
  const b = lines(3200, 'new')
  assert.equal(apply(a, b, hybridDiff(a, b)), b)
})
