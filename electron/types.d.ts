// Shared types for the editorApi contextBridge surface. Imported by the renderer so
// `window.editorApi` is fully typed, and serves as the contract the IPC layer fulfils.

export type FsEntryType = 'file' | 'directory' | 'symlink'

export interface FsTreeEntry {
  name: string
  path: string
  type: FsEntryType
  children?: FsTreeEntry[]
}

export interface OpenWorkspaceResult {
  root: string
}

export interface CurrentWorkspaceResult {
  root: string | null
}

export interface WorkspaceChangedPayload {
  root: string
}

export interface ReadFileResult {
  path: string
  content: string
  mtimeMs: number
  size: number
}


export interface WriteFileResult {
  path: string
  mtimeMs: number
  size: number
}

export interface TreeResult {
  path: string
  entries: FsTreeEntry[]
  truncated: boolean
}

export interface FileListEntry {
  path: string
  rel: string
  name: string
}

export interface ListFilesResult {
  files: FileListEntry[]
  truncated: boolean
}

export interface SearchMatch {
  line: number
  col: number
  text: string
  matchStart: number
  matchEnd: number
}

export interface SearchFileResult {
  file: string // workspace-relative path
  path: string // absolute path
  matches: SearchMatch[]
}

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface SearchResult {
  files: SearchFileResult[]
  total: number
  truncated: boolean
}

export interface ReplaceResult {
  filesChanged: number
  replacements: number
}

export interface DeleteResult {
  path: string
  deleted: boolean
}

export interface AppSettings {
  theme: string
  sidebarWidth: number
  // Diff viewer layout: side-by-side ('split') or single-column GitHub-style ('unified').
  diffMode?: 'split' | 'unified'
  // Debugger interpreter override; empty/absent = auto (.venv/bin/python, else python3).
  pythonPath?: string
}

// --- Python debugging (DAP via debugpy; one session per window) ---

export interface FileBreakpoints {
  path: string
  lines: number[]
}

export type DebugEvent =
  | { kind: 'started' }
  | { kind: 'stopped'; reason: string; path: string | null; line: number | null }
  | { kind: 'continued' }
  | { kind: 'output'; channel: 'stdout' | 'stderr'; text: string }
  | { kind: 'ended'; code: number | null }

export type DebugCommand = 'continue' | 'stepOver' | 'stepIn' | 'stepOut'

export interface DebugStackFrame {
  id: number
  name: string
  line: number
  column: number
  source?: { path?: string; name?: string }
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive?: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  variablesReference: number
}

export interface DebugApi {
  start(filePath: string, breakpoints: FileBreakpoints[], opts?: { noDebug?: boolean }): Promise<{ ok: boolean; python: string }>
  setBreakpoints(filePath: string, lines: number[]): Promise<{ active: boolean }>
  command(command: DebugCommand): Promise<{ ok: boolean }>
  stop(): Promise<{ ok: boolean }>
  stackTrace(): Promise<{ stackFrames: DebugStackFrame[] }>
  scopes(frameId: number): Promise<{ scopes: DebugScope[] }>
  variables(variablesReference: number): Promise<{ variables: DebugVariable[] }>
  onEvent(handler: (event: DebugEvent) => void): () => void
}

export interface GitInfo {
  isRepo: boolean
  branch: string | null
}

export interface GitChange {
  path: string
  status: string // M | A | D | R | U
  raw?: string
}

export interface GitStatusResult {
  files: GitChange[]
}

export interface GitCommit {
  hash: string
  short: string
  author: string
  date: string
  subject: string
}

export interface GitLogResult {
  commits: GitCommit[]
  hasMore: boolean
}

export interface GitCommitFile {
  path: string
  status: string
}

export interface GitCommitFilesResult {
  files: GitCommitFile[]
}

export interface GitFileDiff {
  oldText: string
  newText: string
  oldLabel: string
  newLabel: string
}

export interface GitApi {
  info(): Promise<GitInfo>
  status(): Promise<GitStatusResult>
  log(skip?: number, limit?: number): Promise<GitLogResult>
  commitFiles(hash: string): Promise<GitCommitFilesResult>
  fileDiff(args: { mode: 'working' | 'commit'; file: string; hash?: string }): Promise<GitFileDiff>
}

export type MenuChannel = 'menu:open-folder' | 'menu:open-file' | 'menu:new-file' | 'menu:save' | 'menu:quick-open' | 'menu:settings' | 'menu:close-tab' | 'menu:split' | 'menu:toggle-sidebar' | 'menu:search' | 'menu:preview-side' | 'menu:open-recent' | 'menu:clear-recent' | 'menu:open-loose' | 'menu:open-launch' | 'menu:debug-start' | 'menu:debug-stop' | 'menu:debug-step-over' | 'menu:debug-step-in' | 'menu:debug-step-out' | 'menu:run-file'

// Result of saving an untitled buffer via the native Save-As dialog. `loose` is true when
// the file was written outside the workspace root (subsequent saves go through the loose gate).
export interface SaveAsResult {
  path: string
  name: string
  mtimeMs: number
  size: number
  loose: boolean
}

// Payload for menu:open-loose — a file the OS asked us to open (Finder double-click),
// already read in main as a loose file.
export interface LooseOpenPayload {
  path: string
  content: string
  mtimeMs: number
  size: number
}

export type LaunchOpenRequest =
  | { kind: 'workspace'; path: string }
  | { kind: 'file'; file: LooseOpenPayload; line?: number }

export interface EditorApi {
  openWorkspace(dirPath?: string | null): Promise<OpenWorkspaceResult | null>
  openLooseFile(): Promise<ReadFileResult | null>
  currentWorkspace(): Promise<CurrentWorkspaceResult>
  readFile(filePath: string): Promise<ReadFileResult>
  writeFile(filePath: string, content: string): Promise<WriteFileResult>
  writeLooseFile(filePath: string, content: string): Promise<WriteFileResult>
  readLooseFile(filePath: string): Promise<ReadFileResult>
  saveAs(content: string, suggestedName: string): Promise<SaveAsResult | null>
  tree(dirPath?: string | null, depth?: number): Promise<TreeResult>
  createDir(dirPath: string): Promise<{ path: string }>
  listFiles(): Promise<ListFilesResult>
  search(query: string, options?: SearchOptions): Promise<SearchResult>
  replaceAll(query: string, replacement: string, options?: SearchOptions): Promise<ReplaceResult>
  deletePath(targetPath: string): Promise<DeleteResult>
  renamePath(targetPath: string, newPath: string): Promise<{ path: string }>
  revealInFinder(filePath: string): Promise<{ path: string }>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  recentFolders(): Promise<string[]>
  recentFiles(): Promise<string[]>
  // Open a file from the recents list (validated in main against that list); the opened
  // file arrives back through the menu:open-launch flow.
  openRecentFile(filePath: string): Promise<void>
  // Clears both recent folders AND recent files.
  clearRecentFolders(): Promise<string[]>
  onWorkspaceChanged(handler: (payload: WorkspaceChangedPayload) => void): () => void
  git: GitApi
  debug: DebugApi
  onMenu(channel: 'menu:open-loose', handler: (payload: LooseOpenPayload) => void): () => void
  onMenu(channel: 'menu:open-launch', handler: (request: LaunchOpenRequest) => void): () => void
  onMenu(channel: MenuChannel, handler: (...args: string[]) => void): () => void
}

declare global {
  interface Window {
    editorApi: EditorApi
  }
}
