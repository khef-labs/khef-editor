import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommitBody, splitInlineCode } from '../src/renderer/lib/commitMessage.ts'

test('hard-wrapped paragraphs are reflowed and separated by blank lines', () => {
  const r = parseCommitBody('First paragraph line one\nline two of the same paragraph.\n\nSecond paragraph.')
  assert.deepEqual(r.blocks, [
    { kind: 'paragraph', text: 'First paragraph line one line two of the same paragraph.' },
    { kind: 'paragraph', text: 'Second paragraph.' },
  ])
  assert.deepEqual(r.trailers, [])
})

test('trailing Key: value block becomes trailers, but a lone one-paragraph message stays prose', () => {
  const r = parseCommitBody('Body text.\n\nSession: irena (f773ef0c)\nCo-authored-by: Someone <s@x.y>')
  assert.equal(r.blocks.length, 1)
  assert.deepEqual(r.trailers, [
    { key: 'Session', value: 'irena (f773ef0c)' },
    { key: 'Co-authored-by', value: 'Someone <s@x.y>' },
  ])
  const only = parseCommitBody('Fixes: the crash on open')
  assert.deepEqual(only.trailers, [])
  assert.equal(only.blocks[0].kind, 'paragraph')
})

test('bullet and numbered lists keep their items, with wrapped continuation lines joined', () => {
  const r = parseCommitBody('Changes:\n\n- first item\n  continues here\n- second item\n* third\n\n1. one\n2) two')
  assert.equal(r.blocks[0].kind, 'paragraph')
  assert.deepEqual(r.blocks[1], { kind: 'list', ordered: false, items: ['first item continues here', 'second item', 'third'] })
  assert.deepEqual(r.blocks[2], { kind: 'list', ordered: true, items: ['one', 'two'] })
})

test('fenced and indented code blocks are preserved verbatim', () => {
  const r = parseCommitBody('Run:\n\n```\nnpm test\nnpm run build\n```\n\nOr:\n\n    make all\n    make install')
  assert.deepEqual(r.blocks[1], { kind: 'code', text: 'npm test\nnpm run build' })
  assert.deepEqual(r.blocks[3], { kind: 'code', text: 'make all\nmake install' })
})

test('empty and CRLF bodies', () => {
  assert.deepEqual(parseCommitBody(''), { blocks: [], trailers: [] })
  assert.deepEqual(parseCommitBody('a\r\nb\r\n\r\nc').blocks, [{ kind: 'paragraph', text: 'a b' }, { kind: 'paragraph', text: 'c' }])
})

test('splitInlineCode alternates text and code segments', () => {
  assert.deepEqual(splitInlineCode('use `kf` then `kv`.'), ['use ', 'kf', ' then ', 'kv', '.'])
  assert.deepEqual(splitInlineCode('no code'), ['no code'])
})
