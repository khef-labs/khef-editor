import { useEffect, useState, useCallback } from 'preact/hooks'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FilePlus, FolderPlus } from 'lucide-preact'
import type { FsTreeEntry } from '../../../electron/types'

// Pending inline creation: which kind, and the absolute dir it will be created in.
export interface NewEntrySpec {
  kind: 'file' | 'dir'
  dir: string
}

interface FileTreeProps {
  entries: FsTreeEntry[]
  activePath: string | null
  // Last-clicked row (file or folder) — determines where New File / New Folder create.
  selectedPath: string | null
  refreshToken: number
  // Expansion is CONTROLLED by the owner (App) so the Explorer header's
  // collapse-all / expand-all button can drive every folder at once.
  expandedDirs: Set<string>
  // When set to a dir shown in this tree, an inline name input renders as that
  // folder's first child. (The workspace-root case is rendered by App above the tree.)
  newEntry: NewEntrySpec | null
  onToggleDir: (path: string) => void
  onSelect: (entry: FsTreeEntry) => void
  onOpenFile: (entry: FsTreeEntry) => void
  onOpenFilePermanent: (entry: FsTreeEntry) => void
  onSubmitNewEntry: (name: string) => void
  onCancelNewEntry: () => void
}

export function FileTree(props: FileTreeProps) {
  return (
    <div class="filetree" data-testid="filetree">
      {props.entries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} {...props} />
      ))}
    </div>
  )
}

// Inline name input for New File / New Folder. Rendered by App (root-level) or by the
// target folder's TreeNode (nested). Enter creates, Escape or blur cancels.
export function NewEntryRow({ kind, indent, onSubmit, onCancel }: {
  kind: 'file' | 'dir'
  indent: number
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  return (
    <div class="tree-row explorer-new-entry" style={{ paddingLeft: `${indent}px` }}>
      <span class="tree-icon">{kind === 'dir' ? <FolderPlus size={14} /> : <FilePlus size={14} />}</span>
      <input
        class="explorer-new-input"
        placeholder={kind === 'dir' ? 'folder name' : 'file name'}
        ref={(el) => el?.focus()}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit((e.currentTarget as HTMLInputElement).value)
          else if (e.key === 'Escape') onCancel()
        }}
      />
    </div>
  )
}

type TreeNodeProps = Omit<FileTreeProps, 'entries'> & { entry: FsTreeEntry; depth: number }

function TreeNode(props: TreeNodeProps) {
  const { entry, depth, activePath, selectedPath, refreshToken, expandedDirs, newEntry, onToggleDir, onSelect, onOpenFile, onOpenFilePermanent, onSubmitNewEntry, onCancelNewEntry } = props
  const [children, setChildren] = useState<FsTreeEntry[] | null>(entry.children ?? null)
  const [loading, setLoading] = useState(false)

  const isDir = entry.type === 'directory'
  const isActive = entry.path === activePath
  const isSelected = entry.path === selectedPath
  const expanded = isDir && expandedDirs.has(entry.path)

  const loadChildren = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.editorApi.tree(entry.path, 1)
      setChildren(res.entries)
    } catch {
      setChildren([])
    } finally {
      setLoading(false)
    }
  }, [entry.path])

  useEffect(() => {
    if (!isDir) return
    if (expanded) {
      void loadChildren()
    } else {
      setChildren(entry.children ?? null)
    }
  }, [entry.children, expanded, isDir, loadChildren, refreshToken])

  // Single-click selects the row; files also soft-open (ephemeral preview tab) and
  // directories toggle expansion.
  const toggle = useCallback(() => {
    onSelect(entry)
    if (!isDir) {
      onOpenFile(entry)
      return
    }
    onToggleDir(entry.path)
  }, [isDir, entry, onSelect, onOpenFile, onToggleDir])

  // Double-click a file → open permanently (promote the preview). No-op for directories
  // (their double-click just toggles twice, which is harmless).
  const onDblClick = useCallback(() => {
    if (!isDir) onOpenFilePermanent(entry)
  }, [isDir, entry, onOpenFilePermanent])

  const indent = 8 + depth * 12

  return (
    <div>
      <div
        class={`tree-row${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => void toggle()}
        onDblClick={onDblClick}
        data-testid={`tree-row-${entry.name}`}
      >
        <span class="tree-twisty">
          {isDir ? (
            expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span style={{ width: 14, display: 'inline-block' }} />
          )}
        </span>
        <span class="tree-icon">
          {isDir ? (
            expanded ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            <File size={14} />
          )}
        </span>
        <span class="tree-label">{entry.name}</span>
      </div>
      {isDir && expanded && (
        <div>
          {newEntry && newEntry.dir === entry.path && (
            <NewEntryRow kind={newEntry.kind} indent={indent + 12} onSubmit={onSubmitNewEntry} onCancel={onCancelNewEntry} />
          )}
          {loading && <div class="tree-row tree-loading" style={{ paddingLeft: `${indent + 26}px` }}>…</div>}
          {children?.map((c) => (
            <TreeNode key={c.path} {...props} entry={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
