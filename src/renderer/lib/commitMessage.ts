// Structure a commit body for display. Git bodies are hard-wrapped plain text with a few
// conventions: blank-line paragraphs, `- `/`* `/`1. ` lists, indented or fenced code, and
// a final block of `Key: value` trailers (Signed-off-by, Session, Co-authored-by …). The
// parser turns that into blocks so the UI can reflow paragraphs, keep lists as lists, and
// show trailers as a compact key/value strip instead of one dim monospace wall.

export type CommitBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }

export interface CommitTrailer { key: string; value: string }

export interface ParsedCommitBody {
  blocks: CommitBlock[]
  trailers: CommitTrailer[]
}

const BULLET = /^\s{0,3}([-*•]|\d+[.)])\s+(.*)$/
const TRAILER = /^([A-Za-z][A-Za-z0-9-]*):\s+(.+)$/
const FENCE = /^\s{0,3}```/

// Split into blank-line separated chunks, keeping fenced code together.
function chunks(lines: string[]): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let inFence = false
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      cur.push(line)
      if (!inFence) { out.push(cur); cur = [] }
      continue
    }
    if (inFence) { cur.push(line); continue }
    if (line.trim() === '') { if (cur.length) { out.push(cur); cur = [] } continue }
    cur.push(line)
  }
  if (cur.length) out.push(cur)
  return out
}

function parseChunk(lines: string[]): CommitBlock {
  if (FENCE.test(lines[0])) {
    const body = lines.slice(1, FENCE.test(lines[lines.length - 1]) && lines.length > 1 ? -1 : undefined)
    return { kind: 'code', text: body.join('\n') }
  }
  if (lines.every((l) => /^(\t| {4})/.test(l))) {
    return { kind: 'code', text: lines.map((l) => l.replace(/^(\t| {4})/, '')).join('\n') }
  }
  if (BULLET.test(lines[0])) {
    const items: string[] = []
    let ordered = false
    for (const l of lines) {
      const m = BULLET.exec(l)
      if (m) { items.push(m[2].trim()); if (/\d/.test(m[1])) ordered = true }
      else if (items.length) items[items.length - 1] += ' ' + l.trim()
    }
    return { kind: 'list', ordered, items }
  }
  // Hard-wrapped prose: join lines with single spaces.
  return { kind: 'paragraph', text: lines.map((l) => l.trim()).join(' ') }
}

export function parseCommitBody(body: string): ParsedCommitBody {
  const text = body.replace(/\r\n?/g, '\n').trim()
  if (!text) return { blocks: [], trailers: [] }
  const parts = chunks(text.split('\n'))
  let trailers: CommitTrailer[] = []
  // The LAST chunk is a trailer block when every line is `Key: value` (and it's not the
  // only chunk — a one-paragraph message like "Fixes: the thing" stays prose).
  const last = parts[parts.length - 1]
  if (parts.length > 1 && last && last.every((l) => TRAILER.test(l))) {
    trailers = last.map((l) => { const m = TRAILER.exec(l)!; return { key: m[1], value: m[2].trim() } })
    parts.pop()
  }
  return { blocks: parts.map(parseChunk), trailers }
}

// Split prose on `backticks` so inline code can be styled; returns alternating
// [text, code, text, code, …] segments (even indexes are plain text).
export function splitInlineCode(text: string): string[] {
  return text.split(/`([^`\n]+)`/)
}
