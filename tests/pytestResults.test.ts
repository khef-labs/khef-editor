import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePytestOutput } from '../src/renderer/lib/pytestResults.ts'

// Representative -v -s output with two failures (assertion + raised error), captured from
// a real run (see scratchpad failproj).
const SAMPLE = `============================= test session starts ==============================
collected 3 items

test_sample.py::test_passes PASSED
test_sample.py::test_fails FAILED
test_sample.py::test_errors FAILED

=================================== FAILURES ===================================
___________________________________ test_fails ________________________________

    def test_fails():
        x = 5
>       assert x == 6, "x should be six"
E       AssertionError: x should be six

test_sample.py:6: AssertionError
___________________________________ test_errors _______________________________

    def test_errors():
>       raise ValueError("boom")
E       ValueError: boom

test_sample.py:9: ValueError
=========================== short test summary info ============================
FAILED test_sample.py::test_fails - AssertionError: x should be six
FAILED test_sample.py::test_errors - ValueError: boom
========================= 1 passed, 2 failed in 0.03s ==========================`

test('counts outcomes and lists every test', () => {
  const r = parsePytestOutput(SAMPLE)
  assert.equal(r.results.length, 3)
  assert.equal(r.passed, 1)
  assert.equal(r.failed, 2)
  assert.equal(r.summaryLine, '1 passed, 2 failed in 0.03s')
})

test('attaches traceback file:line to failures in order', () => {
  const r = parsePytestOutput(SAMPLE)
  const fails = r.results.filter((t) => t.outcome === 'failed')
  assert.equal(fails[0].failFile, 'test_sample.py')
  assert.equal(fails[0].failLine, 6)
  assert.equal(fails[1].failLine, 9)
})

test('attaches short-summary reasons by nodeid', () => {
  const r = parsePytestOutput(SAMPLE)
  const f = r.results.find((t) => t.name === 'test_fails')
  assert.equal(f?.reason, 'AssertionError: x should be six')
})

test('an all-passing run has no failures and a passed summary', () => {
  const r = parsePytestOutput('tests/test_friends.py::test_a PASSED\ntests/test_friends.py::test_b PASSED\n===== 2 passed in 0.01s =====')
  assert.equal(r.passed, 2)
  assert.equal(r.failed, 0)
  assert.equal(r.summaryLine, '2 passed in 0.01s')
})

test('partial/streaming output parses without a summary line', () => {
  const r = parsePytestOutput('tests/test_x.py::test_one PASSED\ntests/test_x.py::test_two ')
  assert.equal(r.results.length, 1) // the incomplete second line is ignored
  assert.equal(r.summaryLine, undefined)
})
