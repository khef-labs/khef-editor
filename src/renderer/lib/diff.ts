// Minimal line-based diff for the side-by-side diff view. Computes an LCS over lines and
// emits aligned rows: each row has an optional old line and an optional new line, tagged
// as unchanged / added / removed / modified. Good enough for file-level diffs; not a
// full Myers implementation, but linear-ish and dependency-free.

export type DiffRowKind = 'same' | 'add' | 'del' | 'mod'

export interface DiffRow {
  kind: DiffRowKind
  oldNum: number | null
  newNum: number | null
  oldText: string | null
  newText: string | null
}

// A row of the unified (single-column, GitHub-style) presentation of a diff.
export interface UnifiedRow {
  kind: 'same' | 'add' | 'del'
  oldNum: number | null
  newNum: number | null
  text: string
}

// Flatten aligned side-by-side rows into unified rows. Within each contiguous changed
// run, all removals come before all additions (GitHub hunk order); a 'mod' row
// contributes one removal and one addition.
export function toUnifiedRows(rows: DiffRow[]): UnifiedRow[] {
  const out: UnifiedRow[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].kind === 'same') {
      const r = rows[i]
      out.push({ kind: 'same', oldNum: r.oldNum, newNum: r.newNum, text: r.oldText ?? '' })
      i++
      continue
    }
    const dels: UnifiedRow[] = []
    const adds: UnifiedRow[] = []
    while (i < rows.length && rows[i].kind !== 'same') {
      const r = rows[i]
      if (r.kind === 'del' || r.kind === 'mod') dels.push({ kind: 'del', oldNum: r.oldNum, newNum: null, text: r.oldText ?? '' })
      if (r.kind === 'add' || r.kind === 'mod') adds.push({ kind: 'add', oldNum: null, newNum: r.newNum, text: r.newText ?? '' })
      i++
    }
    out.push(...dels, ...adds)
  }
  return out
}

// Standard LCS table over two string arrays.
function lcs(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

export function computeDiff(oldText: string, newText: string): DiffRow[] {
  const a = oldText.length ? oldText.split('\n') : []
  const b = newText.length ? newText.split('\n') : []
  const dp = lcs(a, b)
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  // Pending removed/added runs we coalesce into 'mod' rows when they line up.
  const dels: { num: number; text: string }[] = []
  const adds: { num: number; text: string }[] = []

  const flush = () => {
    const k = Math.max(dels.length, adds.length)
    for (let x = 0; x < k; x++) {
      const d = dels[x]
      const ad = adds[x]
      if (d && ad) {
        rows.push({ kind: 'mod', oldNum: d.num, newNum: ad.num, oldText: d.text, newText: ad.text })
      } else if (d) {
        rows.push({ kind: 'del', oldNum: d.num, newNum: null, oldText: d.text, newText: null })
      } else if (ad) {
        rows.push({ kind: 'add', oldNum: null, newNum: ad.num, oldText: null, newText: ad.text })
      }
    }
    dels.length = 0
    adds.length = 0
  }

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush()
      rows.push({ kind: 'same', oldNum: i + 1, newNum: j + 1, oldText: a[i], newText: b[j] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      dels.push({ num: i + 1, text: a[i] }); i++
    } else {
      adds.push({ num: j + 1, text: b[j] }); j++
    }
  }
  while (i < a.length) { dels.push({ num: i + 1, text: a[i] }); i++ }
  while (j < b.length) { adds.push({ num: j + 1, text: b[j] }); j++ }
  flush()
  return rows
}
