import { useEffect, useState, useCallback } from 'preact/hooks'
import { Files, Search as SearchIcon, GitBranch, Settings } from 'lucide-preact'
import type { FsTreeEntry, FileListEntry } from '../../electron/types'
import { FileTree } from './components/FileTree'
import { TabBar, type OpenTab } from './components/TabBar'
import { CodeEditor } from './components/CodeEditor'
import { QuickOpen } from './components/QuickOpen'
import { SettingsPanel } from './components/SettingsPanel'
import { themeById, applyTheme } from './lib/themes'

export function App() {
  const [root, setRoot] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string>('')
  const [entries, setEntries] = useState<FsTreeEntry[]>([])
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [themeId, setThemeId] = useState<string>('dark-plus')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Load persisted settings on mount and apply the theme.
  useEffect(() => {
    window.editorApi.getSettings().then((s) => {
      const t = themeById(s.theme)
      setThemeId(t.id)
      applyTheme(t)
    }).catch(() => { applyTheme(themeById('dark-plus')) })
  }, [])

  const selectTheme = useCallback((id: string) => {
    const t = themeById(id)
    setThemeId(t.id)
    applyTheme(t)
    void window.editorApi.setSettings({ theme: t.id })
  }, [])

  const openFolder = useCallback(async () => {
    setError(null)
    try {
      const res = await window.editorApi.openWorkspace()
      if (!res) return
      setRoot(res.root)
      setRootName(res.root.split('/').filter(Boolean).pop() ?? res.root)
      const tree = await window.editorApi.tree(res.root, 1)
      setEntries(tree.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const openPath = useCallback(async (filePath: string, name: string) => {
    setError(null)
    // Already open → just activate.
    const existing = tabs.find((t) => t.path === filePath)
    if (existing) {
      setActivePath(filePath)
      return
    }
    try {
      const res = await window.editorApi.readFile(filePath)
      setTabs((prev) => [
        ...prev,
        { path: res.path, name, content: res.content, savedContent: res.content },
      ])
      setActivePath(res.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tabs])

  const openFile = useCallback((entry: FsTreeEntry) => {
    if (entry.type !== 'file') return
    void openPath(entry.path, entry.name)
  }, [openPath])

  const pickQuickOpen = useCallback((entry: FileListEntry) => {
    setQuickOpen(false)
    void openPath(entry.path, entry.name)
  }, [openPath])

  const updateActiveContent = useCallback((content: string) => {
    setTabs((prev) => prev.map((t) => (t.path === activePath ? { ...t, content } : t)))
  }, [activePath])

  const saveActive = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activePath)
    if (!tab) return
    try {
      await window.editorApi.writeFile(tab.path, tab.content)
      setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, savedContent: t.content } : t)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tabs, activePath])

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path)
      const next = prev.filter((t) => t.path !== path)
      if (path === activePath) {
        const fallback = next[idx] ?? next[idx - 1] ?? null
        setActivePath(fallback ? fallback.path : null)
      }
      return next
    })
  }, [activePath])

  // Menu wiring
  useEffect(() => {
    const offOpen = window.editorApi.onMenu('menu:open-folder', () => void openFolder())
    const offSave = window.editorApi.onMenu('menu:save', () => void saveActive())
    const offQuick = window.editorApi.onMenu('menu:quick-open', () => {
      setQuickOpen((v) => !v)
    })
    const offSettings = window.editorApi.onMenu('menu:settings', () => {
      setSettingsOpen((v) => !v)
    })
    return () => { offOpen(); offSave(); offQuick(); offSettings() }
  }, [openFolder, saveActive])

  // In-renderer Cmd/Ctrl+P as a fallback (also fires when the menu accelerator is
  // intercepted by a focused CodeMirror instance).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        if (root) setQuickOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [root])

  const activeTab = tabs.find((t) => t.path === activePath) ?? null

  return (
    <div class="shell">
      {/* Activity bar (left icon rail) */}
      <nav class="activitybar">
        <button class="act-btn active" title="Explorer"><Files size={22} /></button>
        <button class="act-btn" title="Search (coming)"><SearchIcon size={22} /></button>
        <button class="act-btn" title="Source Control (coming)"><GitBranch size={22} /></button>
        <span class="act-spacer" />
        <button
          class={`act-btn${settingsOpen ? ' active' : ''}`}
          title="Settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Settings size={22} />
        </button>
      </nav>

      {/* Sidebar / Explorer */}
      <aside class="sidebar" data-testid="sidebar">
        <div class="sidebar-header">Explorer</div>
        {root ? (
          <>
            <div class="explorer-root">{rootName}</div>
            <FileTree entries={entries} activePath={activePath} onOpenFile={openFile} />
          </>
        ) : (
          <div class="sidebar-empty">
            <p class="hint">You have not yet opened a folder.</p>
            <button class="open-btn" onClick={() => void openFolder()}>Open Folder</button>
          </div>
        )}
      </aside>

      {/* Editor area */}
      <main class="editor-area">
        {settingsOpen ? (
          <SettingsPanel
            activeTheme={themeId}
            onSelectTheme={selectTheme}
            onClose={() => setSettingsOpen(false)}
          />
        ) : (
          <>
            <TabBar tabs={tabs} activePath={activePath} onActivate={setActivePath} onClose={closeTab} />
            <div class="editor-body">
              {activeTab ? (
                <CodeEditor
                  path={activeTab.path}
                  filename={activeTab.name}
                  value={activeTab.content}
                  themeKey={themeById(themeId).editorTheme}
                  onChange={updateActiveContent}
                  onSave={saveActive}
                />
              ) : (
                <div class="editor-empty">
                  <p class="big-logo">⌘</p>
                  <p class="hint">Open a file from the Explorer to start editing.</p>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Status bar */}
      <footer class="statusbar" data-testid="statusbar">
        <span class="status-left">
          {root ? rootName : 'No folder'}
          {activeTab && ` — ${activeTab.name}${activeTab.content !== activeTab.savedContent ? ' ●' : ''}`}
        </span>
        <span class="status-right">{error ? `⚠ ${error}` : 'khef-editor v0.1.0'}</span>
      </footer>

      {quickOpen && root && (
        <QuickOpen onPick={pickQuickOpen} onClose={() => setQuickOpen(false)} />
      )}
    </div>
  )
}
