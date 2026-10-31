// Find the http(s) URL that covers a column in a line of text. Pure, so it can be unit
// tested; the CodeMirror wiring lives in linkClick.ts.

export type UrlSpan = { from: number; to: number; url: string }

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi
const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

// Drop trailing characters that are almost always sentence or markup punctuation rather
// than part of the URL. A closing bracket stays only when the URL itself opened it, so
// `(see https://x.dev/a_(b))` keeps `_(b)` but `[docs](https://x.dev)` drops the `)`.
function trimTrailing(url: string): string {
  let end = url.length
  for (;;) {
    const ch = url[end - 1]
    if (ch === undefined) break
    if ('.,;:!?*'.includes(ch)) { end--; continue }
    const open = PAIRS[ch]
    if (open) {
      const body = url.slice(0, end)
      const opens = body.split(open).length - 1
      const closes = body.split(ch).length - 1
      if (closes > opens) { end--; continue }
    }
    break
  }
  return url.slice(0, end)
}

/** All URLs in a line, with column offsets. */
export function findUrls(line: string): UrlSpan[] {
  const out: UrlSpan[] = []
  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(line); m; m = URL_RE.exec(line)) {
    const url = trimTrailing(m[0])
    // Bare scheme with nothing after it ("https://") is not a link.
    if (/^https?:\/\/$/i.test(url)) continue
    out.push({ from: m.index, to: m.index + url.length, url })
  }
  return out
}

/** The URL whose characters include column `col` (from <= col < to), or null. */
export function urlAt(line: string, col: number): UrlSpan | null {
  for (const span of findUrls(line)) {
    if (col >= span.from && col < span.to) return span
  }
  return null
}
