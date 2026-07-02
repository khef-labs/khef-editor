// Pure match-counting for the in-editor Find widget. Kept free of CodeMirror view state
// so it can be unit-tested in isolation (see scratchpad findMatches-test). The editor
// passes a doc-like object and the current query flags; this returns the "N of M" state
// the widget renders.
//
// Design (per plan-find-widget, lissy finding #2): the current index is the 1-based
// position of the match whose range EQUALS the current selection (findNext/findPrevious
// select the match, so after navigating, selection == the active match). When the cursor
// is not exactly on a match, `current` is 0 (VS Code shows just the total until you jump).

export interface FindFlags {
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
}

export interface MatchRange {
  from: number
  to: number
}

export interface MatchState {
  current: number // 1-based index of the active match, or 0 when the selection isn't on one
  total: number
  invalid: boolean // true when regexp mode and the pattern is not valid
}

// Upper bound on matches we enumerate, so a huge document with a very common term can't
// freeze the count loop. The widget shows "MAX+" when this is hit (VS Code caps similarly).
export const MAX_MATCHES = 10000

const WORD_CHAR = /[\p{L}\p{N}_]/u

function isWordBoundary(text: string, from: number, to: number): boolean {
  const before = from > 0 ? text[from - 1] : ''
  const after = to < text.length ? text[to] : ''
  const startsWord = WORD_CHAR.test(text[from] ?? '')
  const endsWord = WORD_CHAR.test(text[to - 1] ?? '')
  const beforeWord = before !== '' && WORD_CHAR.test(before)
  const afterWord = after !== '' && WORD_CHAR.test(after)
  return !(startsWord && beforeWord) && !(endsWord && afterWord)
}

// Build the RegExp used to enumerate matches. Returns null when the query is empty or an
// invalid regex (caller treats null-with-nonempty-query as "invalid").
export function buildMatcher(query: string, flags: FindFlags): { re: RegExp } | null {
  if (query.length === 0) return null
  const ignoreCase = flags.caseSensitive ? '' : 'i'
  let source: string
  if (flags.regexp) {
    source = query
  } else {
    source = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  try {
    // 'g' for iteration, 'd' not needed. Unicode-agnostic to match CM's default behavior.
    return { re: new RegExp(source, `g${ignoreCase}`) }
  } catch {
    return null
  }
}

// Enumerate all match ranges in `text` for the query, honoring whole-word and an optional
// scope range [scopeFrom, scopeTo). Bounded by MAX_MATCHES.
export function findMatches(
  text: string,
  query: string,
  flags: FindFlags,
  scope?: MatchRange | null,
): MatchRange[] {
  const built = buildMatcher(query, flags)
  if (!built) return []
  const { re } = built
  const from = scope ? Math.max(0, scope.from) : 0
  const to = scope ? Math.min(text.length, scope.to) : text.length
  const out: MatchRange[] = []
  re.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) break
    const end = m.index + m[0].length
    if (end > to) break
    // Skip zero-width matches but keep the loop advancing so regexes like `a*` can't spin.
    if (m[0].length === 0) {
      re.lastIndex = m.index + 1
      continue
    }
    if (!flags.wholeWord || isWordBoundary(text, m.index, end)) {
      out.push({ from: m.index, to: end })
      if (out.length >= MAX_MATCHES) break
    }
    re.lastIndex = end
  }
  return out
}

// Compute the { current, total, invalid } state the widget renders. `selection` is the
// editor's primary selection range; when it exactly equals a match, that match's 1-based
// index is `current`. Otherwise `current` is 0.
export function computeMatchState(
  text: string,
  query: string,
  flags: FindFlags,
  selection: MatchRange,
  scope?: MatchRange | null,
): MatchState {
  if (query.length === 0) return { current: 0, total: 0, invalid: false }
  const built = buildMatcher(query, flags)
  if (!built) return { current: 0, total: 0, invalid: flags.regexp }
  const matches = findMatches(text, query, flags, scope)
  let current = 0
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from === selection.from && matches[i].to === selection.to) {
      current = i + 1
      break
    }
  }
  return { current, total: matches.length, invalid: false }
}
