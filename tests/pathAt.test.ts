import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findPaths, pathAt } from '../src/renderer/lib/pathAt.ts'

const paths = (s: string) => findPaths(s).map((p) => p.path)

test('finds absolute and home paths with offsets', () => {
  assert.deepEqual(findPaths('open /Users/roger/a.ts now'), [{ from: 5, to: 22, path: '/Users/roger/a.ts' }])
  assert.deepEqual(paths('see ~/.claude/rules/x.md'), ['~/.claude/rules/x.md'])
})

test('parses :line and :line:col suffixes into the span', () => {
  assert.deepEqual(findPaths('/a/b.ts:42'), [{ from: 0, to: 10, path: '/a/b.ts', line: 42 }])
  assert.deepEqual(findPaths('at /a/b.ts:42:7.'), [{ from: 3, to: 15, path: '/a/b.ts', line: 42, col: 7 }])
})

test('drops trailing sentence dots but keeps extensions and a trailing slash', () => {
  assert.deepEqual(paths('Edit /etc/hosts.'), ['/etc/hosts'])
  assert.deepEqual(paths('in /tmp/dir/ folder'), ['/tmp/dir/'])
})

test('stops at quotes, brackets, commas and spaces', () => {
  assert.deepEqual(paths('"/a/b.json", \'/c/d\''), ['/a/b.json', '/c/d'])
  assert.deepEqual(paths('[x](/docs/readme.md)'), ['/docs/readme.md'])
  assert.deepEqual(paths('`/usr/bin/env` and (/opt/x)'), ['/usr/bin/env', '/opt/x'])
})

test('ignores URL tails, relative paths, words with slashes and comments', () => {
  assert.deepEqual(paths('https://example.com/a/b http://localhost:5174/memories/1 file:///etc/passwd'), [])
  assert.deepEqual(paths('./src/a.ts ../b and/or src/c.ts'), [])
  assert.deepEqual(paths('// a comment / with slashes'), [])
  assert.deepEqual(paths('C:\\Users\\x'), [])
})

test('ignores a bare slash or tilde', () => {
  assert.deepEqual(paths('a / b ~/ c'), [])
})

test('pathAt hits only columns inside the path and suffix', () => {
  const line = 'x /a/b.ts:3 y'
  assert.equal(pathAt(line, 1), null)
  assert.equal(pathAt(line, 2)?.path, '/a/b.ts')
  assert.equal(pathAt(line, 10)?.line, 3)
  assert.equal(pathAt(line, 11), null)
})
