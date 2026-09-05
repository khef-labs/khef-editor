import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPytestFile } from '../src/renderer/lib/pytest.ts'

test('matches pytest default naming', () => {
  assert.equal(isPytestFile('/p/tests/test_friends.py'), true)
  assert.equal(isPytestFile('/p/tests/friends_test.py'), true)
  assert.equal(isPytestFile('test_x.py'), true)
})

test('rejects non-test python and other files', () => {
  assert.equal(isPytestFile('/p/myfriends.py'), false)
  assert.equal(isPytestFile('/p/tests/conftest.py'), false)
  assert.equal(isPytestFile('/p/testing.py'), false) // needs the underscore
  assert.equal(isPytestFile('/p/test_data.txt'), false) // not .py
})
