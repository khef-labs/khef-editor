// Debug Adapter Protocol wire framing: Content-Length-prefixed JSON messages (the same
// framing LSP uses). Pure — no I/O — so it is unit-testable and reusable for any DAP
// adapter, not just debugpy.

'use strict'

/** Encode one DAP message object into a framed Buffer. */
function encodeMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/**
 * Streaming decoder. Returns a function to feed raw socket chunks; it invokes `onMessage`
 * once per complete message, buffering partial frames across chunks (a TCP read can end
 * mid-header or mid-body, and can also carry several messages at once).
 */
function createDecoder(onMessage) {
  let buf = Buffer.alloc(0)
  return function feed(chunk) {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk])
    for (;;) {
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = buf.slice(0, headerEnd).toString('ascii')
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) throw new Error(`DAP: malformed header: ${JSON.stringify(header)}`)
      const length = Number(m[1])
      const bodyStart = headerEnd + 4
      if (buf.length < bodyStart + length) return
      const body = buf.slice(bodyStart, bodyStart + length).toString('utf8')
      buf = buf.slice(bodyStart + length)
      onMessage(JSON.parse(body))
    }
  }
}

module.exports = { encodeMessage, createDecoder }
