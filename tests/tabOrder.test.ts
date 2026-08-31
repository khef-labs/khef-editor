import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveTab } from '../src/renderer/lib/tabOrder.ts'

const tabs = [{ path: 'a' }, { path: 'b' }, { path: 'c' }, { path: 'd' }]
const order = (ts: { path: string }[]) => ts.map((t) => t.path).join('')

test('moves a tab forward past later tabs', () => {
  assert.equal(order(moveTab(tabs, 'a', 3)), 'bcad')
  assert.equal(order(moveTab(tabs, 'a', 4)), 'bcda')
})

test('moves a tab backward before earlier tabs', () => {
  assert.equal(order(moveTab(tabs, 'd', 0)), 'dabc')
  assert.equal(order(moveTab(tabs, 'c', 1)), 'acbd')
})

test('dropping into either gap adjacent to the dragged tab is a no-op', () => {
  assert.equal(moveTab(tabs, 'b', 1), tabs) // gap before itself
  assert.equal(moveTab(tabs, 'b', 2), tabs) // gap after itself
})

test('returns the same array for unknown paths and clamps out-of-range gaps', () => {
  assert.equal(moveTab(tabs, 'zzz', 2), tabs)
  assert.equal(order(moveTab(tabs, 'a', 99)), 'bcda')
  assert.equal(order(moveTab(tabs, 'd', -5)), 'dabc')
})
