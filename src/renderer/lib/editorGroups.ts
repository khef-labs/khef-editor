// Editor-group model for split panes. Mirrors VS Code: a row of side-by-side groups,
// each with its own tab list and active tab. One group is "focused" — new file opens
// and Cmd+W act on it.

export interface OpenTab {
  path: string
  name: string
  content: string
  savedContent: string
  loose?: boolean
  kind?: 'editor' | 'preview' | 'diff' | 'console'
  sourcePath?: string
  diff?: { mode: 'working' | 'commit'; file: string; hash?: string }
  // VS Code "preview tab" soft-open flag. Kept in sync with layout.ts's OpenTab. Only set
  // on plain editor tabs (never kind:'preview'/'diff').
  ephemeral?: boolean
  // New unsaved buffer (Cmd+N). Kept in sync with layout.ts's OpenTab.
  untitled?: boolean
}

export interface EditorGroup {
  id: string
  tabs: OpenTab[]
  activePath: string | null
}

// Hover tooltip for a tab: the real file path, not the synthetic tab id. Preview tabs
// point at their source file, diff tabs at the repo-relative file under diff, untitled
// buffers have no path so the buffer name stands in.
export function tabHoverPath(tab: Pick<OpenTab, 'path' | 'name' | 'sourcePath' | 'diff' | 'untitled' | 'kind'>): string {
  if (tab.untitled || tab.kind === 'console') return tab.name
  if (tab.sourcePath) return tab.sourcePath
  if (tab.diff) return tab.diff.file
  return tab.path
}

let groupSeq = 0
export function nextGroupId(): string {
  return `g${++groupSeq}`
}

export function makeGroup(tabs: OpenTab[] = [], activePath: string | null = null): EditorGroup {
  return { id: nextGroupId(), tabs, activePath }
}
