import { test } from 'node:test'
import assert from 'node:assert/strict'
import { childRequests, assembleChildren, MAX_INDEXED, type VarChild } from '../src/renderer/lib/debugVariables.ts'

test('a non-collection makes a single plain request', () => {
  assert.deepEqual(childRequests({ variablesReference: 5 }), [{ ref: 5 }])
})

test('a pure array requests only indexed elements (this is the cart bug)', () => {
  // rdbg reports #class as a named member but arrays advertise indexedVariables; a plain
  // request returns only #class, so we must ask for the indexed page.
  assert.deepEqual(childRequests({ variablesReference: 7, indexedVariables: 2, namedVariables: 0 }), [
    { ref: 7, filter: 'indexed', start: 0, count: 2 },
  ])
})

test('a collection with named members requests named then indexed, in order', () => {
  assert.deepEqual(childRequests({ variablesReference: 7, indexedVariables: 3, namedVariables: 1 }), [
    { ref: 7, filter: 'named', start: 0, count: 1 },
    { ref: 7, filter: 'indexed', start: 0, count: 3 },
  ])
})

test('a huge collection is capped at MAX_INDEXED', () => {
  const reqs = childRequests({ variablesReference: 7, indexedVariables: 100000 })
  assert.equal(reqs[reqs.length - 1].count, MAX_INDEXED)
})

test('assembleChildren concatenates results in request order', () => {
  const named: VarChild[] = [{ name: '#class', value: 'Array', variablesReference: 0 }]
  const indexed: VarChild[] = [
    { name: '0', value: 'a', variablesReference: 8 },
    { name: '1', value: 'b', variablesReference: 9 },
  ]
  const out = assembleChildren({ variablesReference: 7, indexedVariables: 2, namedVariables: 1 }, [named, indexed])
  assert.deepEqual(out.map((c) => c.name), ['#class', '0', '1'])
})

test('assembleChildren appends a truncation marker past the cap', () => {
  const page: VarChild[] = Array.from({ length: MAX_INDEXED }, (_, i) => ({ name: String(i), value: 'x', variablesReference: 0 }))
  const out = assembleChildren({ variablesReference: 7, indexedVariables: MAX_INDEXED + 42 }, [page])
  assert.equal(out.length, MAX_INDEXED + 1)
  assert.equal(out[out.length - 1].value, '42 more elements')
})
