import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tooltipPosition } from '../src/renderer/lib/tooltip.ts'

const vp = { width: 1000, height: 600 }
const tip = { width: 300, height: 24 }

test('sits below the target, aligned to its left edge', () => {
  const pos = tooltipPosition({ left: 100, top: 40, right: 200, bottom: 70 }, tip, vp)
  assert.deepEqual(pos, { left: 100, top: 76 })
})

test('clamps to the right viewport edge for targets near it', () => {
  const pos = tooltipPosition({ left: 900, top: 40, right: 960, bottom: 70 }, tip, vp)
  assert.equal(pos.left, 1000 - 300 - 8)
})

test('never goes past the left margin', () => {
  const pos = tooltipPosition({ left: -50, top: 40, right: 20, bottom: 70 }, tip, vp)
  assert.equal(pos.left, 8)
})

test('flips above the target when there is no room below', () => {
  const pos = tooltipPosition({ left: 100, top: 560, right: 200, bottom: 590 }, tip, vp)
  assert.equal(pos.top, 560 - 24 - 6)
})

test('right placement sits beside the target, vertically centered', () => {
  const pos = tooltipPosition({ left: 0, top: 100, right: 240, bottom: 122 }, tip, vp, 'right')
  assert.deepEqual(pos, { left: 246, top: 111 - 12 })
})

test('right placement clamps inside the viewport', () => {
  const pos = tooltipPosition({ left: 0, top: 2, right: 800, bottom: 24 }, tip, vp, 'right')
  assert.equal(pos.left, 1000 - 300 - 8)
  assert.equal(pos.top, 8)
})
