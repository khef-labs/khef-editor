import { useEffect, useState, useCallback } from 'preact/hooks'
import type { FsTreeEntry } from '../../electron/types'

// Scaffold shell: title bar, sidebar slot, empty editor pane, status bar. "Open
// Folder" exercises the IPC fs seam end-to-end (open workspace + list tree root) to
// prove the renderer↔main↔disk pipeline. The real FileTree/editor land in the next
// story (story-reuse-editor-core, now "build editor core fresh").

export function App() {
  const [root, setRoot] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsTreeEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const openFolder = useCallback(async () => {
    setError(null)
    try {
      const res = await window.editorApi.openWorkspace()
      if (!res) return // user canceled
      setRoot(res.root)
      const tree = await window.editorApi.tree(res.root, 1)
      setEntries(tree.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    const off = window.editorApi.onMenu('menu:open-folder', () => void openFolder())
    return off
  }, [openFolder])

  return (
    <div class="shell">
      <header class="titlebar">
        <span class="brand">Khef Editor</span>
        <span class="subtitle">{root ?? 'No folder open'}</span>
      </header>

      <div class="body">
        <aside class="sidebar" data-testid="sidebar">
          {root ? (
            <ul class="tree-root">
              {entries.map((e) => (
                <li key={e.path} class={`tree-entry tree-${e.type}`}>
                  {e.type === 'directory' ? '📁' : e.type === 'symlink' ? '🔗' : '📄'} {e.name}
                </li>
              ))}
            </ul>
          ) : (
            <div class="sidebar-empty">
              <button class="open-btn" onClick={() => void openFolder()}>
                Open Folder…
              </button>
              <p class="hint">⌘O</p>
            </div>
          )}
        </aside>

        <main class="editor-pane" data-testid="editor-pane">
          <div class="editor-empty">
            <p>No file open</p>
            <p class="hint">Open a folder, then pick a file (coming next).</p>
          </div>
        </main>
      </div>

      <footer class="statusbar" data-testid="statusbar">
        <span>{error ? `⚠ ${error}` : root ? `${entries.length} items` : 'Ready'}</span>
        <span class="status-right">khef-editor v0.1.0</span>
      </footer>
    </div>
  )
}
