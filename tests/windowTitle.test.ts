import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windowTitle } from '../src/renderer/lib/windowTitle.ts'

test('shows the app name then the open folder', () => {
  assert.equal(windowTitle('khef-editor'), 'Khef Editor — khef-editor')
})

test('falls back to the plain app name with no workspace', () => {
  assert.equal(windowTitle(''), 'Khef Editor')
})
