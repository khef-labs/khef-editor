import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabHoverPath } from '../src/renderer/lib/editorGroups.ts'

test('editor tabs show their absolute path', () => {
  assert.equal(tabHoverPath({ path: '/repo/src/a.ts', name: 'a.ts' }), '/repo/src/a.ts')
})

test('preview tabs show the source file, not the synthetic tab id', () => {
  assert.equal(
    tabHoverPath({ path: 'preview:///repo/README.md', name: 'Preview README.md', sourcePath: '/repo/README.md' }),
    '/repo/README.md',
  )
})

test('diff tabs show the file under diff', () => {
  assert.equal(
    tabHoverPath({ path: 'diff://working/src/a.ts', name: 'a.ts (Working Tree)', diff: { mode: 'working', file: 'src/a.ts' } }),
    'src/a.ts',
  )
})

test('untitled buffers fall back to the buffer name', () => {
  assert.equal(tabHoverPath({ path: 'untitled:1', name: 'Untitled-1', untitled: true }), 'Untitled-1')
})
