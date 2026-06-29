// Lightweight subsequence fuzzy matcher, VS Code-flavored: every query char must
// appear in order; contiguous runs, word-boundary hits, and basename matches score
// higher. Returns null when the query isn't a subsequence of the target.

export interface FuzzyResult {
  score: number
  // indices in the target that matched, for highlight rendering
  positions: number[]
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (query.length === 0) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  let score = 0
  let prevMatchIdx = -2
  const positions: number[] = []

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti)
      // Base point per matched char.
      score += 1
      // Contiguous bonus.
      if (ti === prevMatchIdx + 1) score += 3
      // Word-boundary bonus (start, or after a separator).
      const prevCh = ti > 0 ? target[ti - 1] : ''
      if (ti === 0 || prevCh === '/' || prevCh === '_' || prevCh === '-' || prevCh === '.') {
        score += 4
      }
      // Camel-hump bonus.
      if (prevCh && prevCh === prevCh.toLowerCase() && target[ti] !== target[ti].toLowerCase()) {
        score += 2
      }
      prevMatchIdx = ti
      qi++
    }
  }

  if (qi < q.length) return null // not a full subsequence

  // Prefer matches that land in the basename (after the last slash).
  const slash = target.lastIndexOf('/')
  if (positions.length && positions[0] > slash) score += 5

  // Slightly prefer shorter targets.
  score -= target.length * 0.01

  return { score, positions }
}
