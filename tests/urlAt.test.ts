import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findUrls, urlAt } from '../src/renderer/lib/urlAt.ts'

const urls = (s: string) => findUrls(s).map((u) => u.url)

test('finds a bare URL with offsets', () => {
  const line = 'see https://example.com/a?b=1 now'
  assert.deepEqual(findUrls(line), [{ from: 4, to: 29, url: 'https://example.com/a?b=1' }])
})

test('drops trailing sentence punctuation', () => {
  assert.deepEqual(urls('Go to https://example.com.'), ['https://example.com'])
  assert.deepEqual(urls('https://a.dev/x, https://b.dev/y;'), ['https://a.dev/x', 'https://b.dev/y'])
  assert.deepEqual(urls('really? https://example.com/?!'), ['https://example.com/'])
})

test('drops an unbalanced closing bracket but keeps a balanced one', () => {
  assert.deepEqual(urls('[docs](https://example.com/docs)'), ['https://example.com/docs'])
  assert.deepEqual(urls('(https://en.wikipedia.org/wiki/Foo_(bar))'), ['https://en.wikipedia.org/wiki/Foo_(bar)'])
})

test('stops at quotes and angle brackets', () => {
  assert.deepEqual(urls('href="https://example.com/x"'), ['https://example.com/x'])
  assert.deepEqual(urls('<https://example.com>'), ['https://example.com'])
  assert.deepEqual(urls("url = 'http://localhost:5174/memories/1'"), ['http://localhost:5174/memories/1'])
})

test('ignores non-http schemes and a bare scheme', () => {
  assert.deepEqual(urls('file:///etc/passwd javascript:alert(1) ftp://x.y'), [])
  assert.deepEqual(urls('just https:// here'), [])
})

test('urlAt hits only columns inside the URL', () => {
  const line = 'x https://a.dev y'
  assert.equal(urlAt(line, 1), null)
  assert.equal(urlAt(line, 2)?.url, 'https://a.dev')
  assert.equal(urlAt(line, 14)?.url, 'https://a.dev')
  assert.equal(urlAt(line, 15), null)
})

test('findUrls is safe to call repeatedly (global regex state)', () => {
  assert.equal(urlAt('https://a.dev', 0)?.url, 'https://a.dev')
  assert.equal(urlAt('https://a.dev', 0)?.url, 'https://a.dev')
})
