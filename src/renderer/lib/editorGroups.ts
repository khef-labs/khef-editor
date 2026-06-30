// Editor-group model for split panes. Mirrors VS Code: a row of side-by-side groups,
// each with its own tab list and active tab. One group is "focused" — new file opens
// and Cmd+W act on it.

export interface OpenTab {
  path: string
  name: string
  content: string
  savedContent: string
  loose?: boolean
  kind?: 'editor' | 'preview'
  sourcePath?: string
}

export interface EditorGroup {
  id: string
  tabs: OpenTab[]
  activePath: string | null
}

let groupSeq = 0
export function nextGroupId(): string {
  return `g${++groupSeq}`
}

export function makeGroup(tabs: OpenTab[] = [], activePath: string | null = null): EditorGroup {
  return { id: nextGroupId(), tabs, activePath }
}
