import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveTab, nextTabIndex } from '../src/renderer/lib/tabOrder.ts'

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

test('nextTabIndex cycles forward and back within the pane', () => {
  assert.equal(nextTabIndex(4, 0, 1), 1)
  assert.equal(nextTabIndex(4, 2, -1), 1)
})

test('nextTabIndex wraps at both ends', () => {
  assert.equal(nextTabIndex(4, 3, 1), 0) // last → first
  assert.equal(nextTabIndex(4, 0, -1), 3) // first → last
})

test('nextTabIndex treats no-active-tab (-1) as starting from 0', () => {
  assert.equal(nextTabIndex(4, -1, 1), 1)
  assert.equal(nextTabIndex(4, -1, -1), 3)
})

test('nextTabIndex returns -1 when there is nothing to cycle to', () => {
  assert.equal(nextTabIndex(1, 0, 1), -1)
  assert.equal(nextTabIndex(0, -1, 1), -1)
})
