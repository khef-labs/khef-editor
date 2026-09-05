// Next tab index when cycling by `dir` (+1 next / -1 previous) from `current`, wrapping
// at both ends (VS Code behavior). `current` may be -1 (no active tab) — treated as 0.
// Returns -1 when there are fewer than 2 tabs (nothing to cycle to).
export function nextTabIndex(count: number, current: number, dir: 1 | -1): number {
  if (count < 2) return -1
  const from = current < 0 ? 0 : current
  return (from + dir + count) % count
}

// Reorder a pane's tab list by drag-and-drop. `toGap` is an insertion gap index in the
// PRE-REMOVAL list (0 = before the first tab, tabs.length = after the last), which is
// what a drop indicator naturally produces. Returns the same array when the move is a
// no-op so callers can keep state identity.
export function moveTab<T extends { path: string }>(tabs: T[], fromPath: string, toGap: number): T[] {
  const from = tabs.findIndex((t) => t.path === fromPath)
  if (from < 0) return tabs
  const gap = Math.max(0, Math.min(toGap, tabs.length))
  // Dropping into either gap adjacent to the dragged tab leaves the order unchanged.
  const insert = gap > from ? gap - 1 : gap
  if (insert === from) return tabs
  const next = [...tabs]
  const [tab] = next.splice(from, 1)
  next.splice(insert, 0, tab)
  return next
}
