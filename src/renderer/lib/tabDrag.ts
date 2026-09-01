// Window-scoped state for an in-progress tab drag. Every TabBar reads this instead of
// dataTransfer so a drop knows the SOURCE pane, and so drags that originate outside this
// window (another Khef Editor window, another app) can never trigger a tab move — their
// drags never set this. One drag at a time per window, by construction.
export interface TabDragSource {
  leafId: string
  path: string
}

let current: TabDragSource | null = null

export function beginTabDrag(leafId: string, path: string): void {
  current = { leafId, path }
}

export function getTabDrag(): TabDragSource | null {
  return current
}

export function endTabDrag(): void {
  current = null
}
