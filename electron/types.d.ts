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
}

export type MenuChannel = 'menu:open-folder' | 'menu:open-file' | 'menu:save' | 'menu:quick-open' | 'menu:settings' | 'menu:close-tab' | 'menu:split'

export interface EditorApi {
  openWorkspace(dirPath?: string | null): Promise<OpenWorkspaceResult | null>
  openLooseFile(): Promise<ReadFileResult | null>
  currentWorkspace(): Promise<CurrentWorkspaceResult>
  readFile(filePath: string): Promise<ReadFileResult>
  writeFile(filePath: string, content: string): Promise<WriteFileResult>
  writeLooseFile(filePath: string, content: string): Promise<WriteFileResult>
  tree(dirPath?: string | null, depth?: number): Promise<TreeResult>
  listFiles(): Promise<ListFilesResult>
  search(query: string, options?: SearchOptions): Promise<SearchResult>
  replaceAll(query: string, replacement: string, options?: SearchOptions): Promise<ReplaceResult>
  deletePath(targetPath: string): Promise<DeleteResult>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  onMenu(channel: MenuChannel, handler: () => void): () => void
}

declare global {
  interface Window {
    editorApi: EditorApi
  }
}
