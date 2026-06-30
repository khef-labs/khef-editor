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
