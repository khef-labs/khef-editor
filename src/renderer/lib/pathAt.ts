// Find an absolute (`/…`) or home-relative (`~/…`) file path that covers a column in a
// line of text, with an optional `:line` or `:line:col` suffix. Pure, so it can be unit
// tested; linkClick.ts does the CodeMirror wiring and main decides what may be opened.

export type PathSpan = { from: number; to: number; path: string; line?: number; col?: number }

// A path starts with `/` or `~/` that is NOT glued to a word, another slash, a colon or a
// dot. That rules out the tails of URLs (`https://host/a`, `file:///etc`), `a/b` words,
// `//` comments and `./rel` paths. Segment characters are deliberately conservative: no
// spaces, quotes, brackets, commas or colons, so surrounding prose and markup stay out.
const PATH_RE = /(?<![\w/:.~\\-])(~?\/[\w.@%+~-]+(?:\/[\w.@%+~-]*)*)(?::(\d+)(?::(\d+))?)?/g

/** All file paths in a line, with column offsets covering the path and any suffix. */
export function findPaths(line: string): PathSpan[] {
  const out: PathSpan[] = []
  PATH_RE.lastIndex = 0
  for (let m = PATH_RE.exec(line); m; m = PATH_RE.exec(line)) {
    let path = m[1]
    let to = m.index + m[0].length
    let lineNo: number | undefined
    let col: number | undefined
    if (m[2]) {
      lineNo = Number(m[2])
      if (m[3]) col = Number(m[3])
    } else {
      // No suffix: drop sentence punctuation stuck to the end ("see /a/b.ts.").
      const trimmed = path.replace(/[.]+$/, '')
      to -= path.length - trimmed.length
      path = trimmed
    }
    // A trailing slash is fine (a folder), but a bare `/` or `~/` is not a link.
    if (path === '/' || path === '~/' || path.length < 3) continue
    const span: PathSpan = { from: m.index, to, path }
    if (lineNo !== undefined && lineNo > 0) span.line = lineNo
    if (col !== undefined && col > 0) span.col = col
    out.push(span)
  }
  return out
}

/** The path whose characters include column `col` (from <= col < to), or null. */
export function pathAt(line: string, col: number): PathSpan | null {
  for (const span of findPaths(line)) {
    if (col >= span.from && col < span.to) return span
  }
  return null
}
