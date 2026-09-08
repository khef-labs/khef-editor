// Line-first diff for the merge views. @codemirror/merge diffs at the CHARACTER level with
// Myers' algorithm, which is O((N+M)·D) in characters — on a large file with a modest number
// of changed lines (a lockfile, a generated file) it blows past its scan limit and falls back
// to marking huge regions as one change. This does what git does instead: diff LINES first
// (each unique line encoded as one character so the package's optimized Myers can be reused
// on a string of line ids), then refine each changed block at character level so word-level
// highlighting still works. Plugged in via `diffConfig.override`.

import { diff, Change } from '@codemirror/merge'

// Line ids are packed into UTF-16 code units; stay below the surrogate range so every id is
// exactly one unit and Change offsets map 1:1 onto line indices.
const MAX_UNIQUE_LINES = 0xd800
// Changed blocks bigger than this (in characters, both sides) are left at line granularity —
// a wholesale rewrite gains nothing from word marks and the char pass would be slow.
const REFINE_MAX_CHARS = 20000

// Start offset of every line, plus a final entry equal to text.length, so line i spans
// [starts[i], starts[i+1]) with its newline included.
export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  starts.push(text.length)
  return starts
}

function encodeLines(text: string, starts: number[], ids: Map<string, number>): string | null {
  let out = ''
  for (let i = 0; i < starts.length - 1; i++) {
    const line = text.slice(starts[i], starts[i + 1])
    let id = ids.get(line)
    if (id === undefined) {
      id = ids.size
      if (id >= MAX_UNIQUE_LINES) return null
      ids.set(line, id)
    }
    out += String.fromCharCode(id)
  }
  return out
}

export function hybridDiff(a: string, b: string): readonly Change[] {
  if (a === b) return []
  const startsA = lineStarts(a)
  const startsB = lineStarts(b)
  const ids = new Map<string, number>()
  const encA = encodeLines(a, startsA, ids)
  const encB = encA === null ? null : encodeLines(b, startsB, ids)
  // Pathologically many distinct lines: let the package do its bounded best.
  if (encA === null || encB === null) return diff(a, b, { scanLimit: 500, timeout: 2000 })

  // Line pass. The scan limit here counts changed LINES, so it can be generous; the timeout
  // bounds the rare huge-rewrite case.
  const lineChanges = diff(encA, encB, { scanLimit: 20000, timeout: 1500 })
  const out: Change[] = []
  for (const c of lineChanges) {
    const fromA = startsA[c.fromA], toA = startsA[c.toA]
    const fromB = startsB[c.fromB], toB = startsB[c.toB]
    if (toA > fromA && toB > fromB && (toA - fromA) + (toB - fromB) <= REFINE_MAX_CHARS) {
      const sub = diff(a.slice(fromA, toA), b.slice(fromB, toB), { scanLimit: 500, timeout: 500 })
      for (const r of sub) out.push(new Change(r.fromA + fromA, r.toA + fromA, r.fromB + fromB, r.toB + fromB))
      continue
    }
    out.push(new Change(fromA, toA, fromB, toB))
  }
  return out
}
