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

export interface DeleteResult {
  path: string
  deleted: boolean
}

export interface AppSettings {
  theme: string
}

export type MenuChannel = 'menu:open-folder' | 'menu:save' | 'menu:quick-open' | 'menu:settings' | 'menu:close-tab'

export interface EditorApi {
  openWorkspace(dirPath?: string | null): Promise<OpenWorkspaceResult | null>
  currentWorkspace(): Promise<CurrentWorkspaceResult>
  readFile(filePath: string): Promise<ReadFileResult>
  writeFile(filePath: string, content: string): Promise<WriteFileResult>
  tree(dirPath?: string | null, depth?: number): Promise<TreeResult>
  listFiles(): Promise<ListFilesResult>
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
