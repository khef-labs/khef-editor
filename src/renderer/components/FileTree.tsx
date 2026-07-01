import { useState, useCallback } from 'preact/hooks'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-preact'
import type { FsTreeEntry } from '../../../electron/types'

interface FileTreeProps {
  entries: FsTreeEntry[]
  activePath: string | null
  onOpenFile: (entry: FsTreeEntry) => void
  onOpenFilePermanent: (entry: FsTreeEntry) => void
}

export function FileTree({ entries, activePath, onOpenFile, onOpenFilePermanent }: FileTreeProps) {
  return (
    <div class="filetree" data-testid="filetree">
      {entries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} activePath={activePath} onOpenFile={onOpenFile} onOpenFilePermanent={onOpenFilePermanent} />
      ))}
    </div>
  )
}

interface TreeNodeProps {
  entry: FsTreeEntry
  depth: number
  activePath: string | null
  onOpenFile: (entry: FsTreeEntry) => void
  onOpenFilePermanent: (entry: FsTreeEntry) => void
}

function TreeNode({ entry, depth, activePath, onOpenFile, onOpenFilePermanent }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsTreeEntry[] | null>(entry.children ?? null)
  const [loading, setLoading] = useState(false)

  const isDir = entry.type === 'directory'
  const isActive = entry.path === activePath

  // Single-click a file → soft-open (ephemeral preview tab). Directories toggle expand.
  const toggle = useCallback(async () => {
    if (!isDir) {
      onOpenFile(entry)
      return
    }
    const next = !expanded
    setExpanded(next)
    // Lazy-load children the first time we expand.
    if (next && children === null) {
      setLoading(true)
      try {
        const res = await window.editorApi.tree(entry.path, 1)
        setChildren(res.entries)
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }, [isDir, expanded, children, entry, onOpenFile])

  // Double-click a file → open permanently (promote the preview). No-op for directories
  // (their double-click just toggles twice, which is harmless).
  const onDblClick = useCallback(() => {
    if (!isDir) onOpenFilePermanent(entry)
  }, [isDir, entry, onOpenFilePermanent])

  const indent = 8 + depth * 12

  return (
    <div>
      <div
        class={`tree-row${isActive ? ' active' : ''}`}
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
          {loading && <div class="tree-row tree-loading" style={{ paddingLeft: `${indent + 26}px` }}>…</div>}
          {children?.map((c) => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} activePath={activePath} onOpenFile={onOpenFile} onOpenFilePermanent={onOpenFilePermanent} />
          ))}
        </div>
      )}
    </div>
  )
}
