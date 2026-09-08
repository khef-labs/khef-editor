import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addNote, updateNote, removeNote, notesFor, groupNotes, notesToMarkdown, noteRef, parseNoteRef, type ReviewNote } from '../src/renderer/lib/reviewNotes.ts'

const mk = (over: Partial<ReviewNote>): ReviewNote => ({
  id: over.id ?? Math.random().toString(36).slice(2), ref: 'commit:abc', file: 'src/a.ts', side: 'new', line: 1, text: 'hi', createdAt: '2026-09-07T00:00:00Z', ...over,
})

test('noteRef round-trips every diff mode', () => {
  for (const spec of [{ mode: 'working' as const }, { mode: 'staged' as const }, { mode: 'commit' as const, hash: 'abc' }, { mode: 'range' as const, hash: 'mb1' }]) {
    assert.deepEqual(parseNoteRef(noteRef(spec)), spec)
  }
  assert.equal(noteRef({ mode: 'working', hash: 'ignored' }), 'working:')
  assert.equal(parseNoteRef('commit:'), null)
  assert.equal(parseNoteRef('nonsense'), null)
})

test('add, update, remove are immutable and targeted', () => {
  const a = mk({ id: 'a' }), b = mk({ id: 'b', line: 5 })
  const list = addNote(addNote([], a), b)
  assert.equal(list.length, 2)
  const upd = updateNote(list, 'a', 'changed', '2026-09-08T00:00:00Z')
  assert.equal(upd[0].text, 'changed')
  assert.equal(upd[0].updatedAt, '2026-09-08T00:00:00Z')
  assert.equal(upd[1].text, 'hi')
  assert.equal(list[0].text, 'hi', 'original untouched')
  assert.deepEqual(removeNote(upd, 'a').map((n) => n.id), ['b'])
})

test('notesFor filters by ref, file and optional side, in line order', () => {
  const notes = [
    mk({ id: '1', line: 9 }), mk({ id: '2', line: 3 }), mk({ id: '3', line: 3, side: 'old' }),
    mk({ id: '4', file: 'other.ts' }), mk({ id: '5', ref: 'working:' }),
  ]
  assert.deepEqual(notesFor(notes, 'commit:abc', 'src/a.ts').map((n) => n.id), ['2', '3', '1'])
  assert.deepEqual(notesFor(notes, 'commit:abc', 'src/a.ts', 'old').map((n) => n.id), ['3'])
  assert.deepEqual(notesFor(notes, 'working:', 'src/a.ts').map((n) => n.id), ['5'])
})

test('groupNotes nests ref → file → notes', () => {
  const notes = [mk({ id: '1', line: 4 }), mk({ id: '2', file: 'b.ts' }), mk({ id: '3', ref: 'working:' }), mk({ id: '4', line: 2 })]
  const g = groupNotes(notes)
  assert.deepEqual(g.map((x) => x.ref), ['commit:abc', 'working:'])
  assert.deepEqual(g[0].files.map((f) => f.file), ['src/a.ts', 'b.ts'])
  assert.deepEqual(g[0].files[0].notes.map((n) => n.id), ['4', '1'])
})

test('notesToMarkdown renders headings, locations, sides and multi-line text', () => {
  const md = notesToMarkdown([
    mk({ line: 12, text: 'first line\nsecond line' }),
    mk({ line: 3, side: 'old', text: 'removed on purpose?' }),
  ], (ref) => `commit ${ref.slice(7)}`)
  assert.equal(md, [
    '## commit abc', '',
    '- `src/a.ts:3` (old) — removed on purpose?',
    '- `src/a.ts:12` — first line\n  second line', '',
  ].join('\n'))
  assert.equal(notesToMarkdown([]), '')
})
