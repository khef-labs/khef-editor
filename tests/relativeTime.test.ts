import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relativeTime } from '../src/renderer/lib/relativeTime.ts'

const now = Date.parse('2026-09-07T12:00:00Z')
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

test('buckets from seconds to years', () => {
  assert.equal(relativeTime(ago(10), now), 'just now')
  assert.equal(relativeTime(ago(90), now), '2m ago')
  assert.equal(relativeTime(ago(3 * 3600), now), '3h ago')
  assert.equal(relativeTime(ago(2 * 86400), now), '2d ago')
  assert.equal(relativeTime(ago(15 * 86400), now), '2w ago')
  assert.equal(relativeTime(ago(70 * 86400), now), '2mo ago')
  assert.equal(relativeTime(ago(800 * 86400), now), '2y ago')
})

test('never reports a negative age and tolerates bad input', () => {
  assert.equal(relativeTime(new Date(now + 5000).toISOString(), now), 'just now')
  assert.equal(relativeTime('not a date', now), '')
})

test('accepts git %aI dates with a zone offset', () => {
  assert.equal(relativeTime('2026-09-07T05:00:00-07:00', now), 'just now')
})
