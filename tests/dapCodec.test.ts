import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeMessage, createDecoder } from '../electron/dap-codec.cjs'

test('round-trips a message through encode and decode', () => {
  const out: unknown[] = []
  const feed = createDecoder((m: unknown) => out.push(m))
  feed(encodeMessage({ seq: 1, type: 'request', command: 'initialize' }))
  assert.deepEqual(out, [{ seq: 1, type: 'request', command: 'initialize' }])
})

test('reassembles a frame split across arbitrary chunk boundaries', () => {
  const buf = encodeMessage({ seq: 2, type: 'event', event: 'stopped', body: { reason: 'breakpoint' } })
  for (let split = 1; split < buf.length; split++) {
    const out: unknown[] = []
    const feed = createDecoder((m: unknown) => out.push(m))
    feed(buf.subarray(0, split))
    feed(buf.subarray(split))
    assert.equal(out.length, 1, `split at ${split}`)
  }
})

test('decodes several messages arriving in one chunk', () => {
  const out: { seq: number }[] = []
  const feed = createDecoder((m: { seq: number }) => out.push(m))
  const chunk = Buffer.concat([1, 2, 3].map((seq) => encodeMessage({ seq, type: 'event', event: 'output' })))
  feed(chunk)
  assert.deepEqual(out.map((m) => m.seq), [1, 2, 3])
})

test('handles multi-byte UTF-8 in the body (Content-Length is bytes, not chars)', () => {
  const out: { body?: { output: string } }[] = []
  const feed = createDecoder((m: { body?: { output: string } }) => out.push(m))
  feed(encodeMessage({ seq: 1, type: 'event', event: 'output', body: { output: 'héllo → 世界' } }))
  assert.equal(out[0]?.body?.output, 'héllo → 世界')
})

test('throws on a malformed header', () => {
  const feed = createDecoder(() => {})
  assert.throws(() => feed(Buffer.from('Content-Weight: 5\r\n\r\nhello')), /malformed header/)
})
