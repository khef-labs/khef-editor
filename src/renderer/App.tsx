import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { Files, Search as SearchIcon, GitBranch, Settings } from 'lucide-preact'
import type { FsTreeEntry, FileListEntry } from '../../electron/types'
import { FileTree } from './components/FileTree'
import { QuickOpen } from './components/QuickOpen'
import { SettingsPanel } from './components/SettingsPanel'
import { PaneTree } from './components/PaneTree'
import { themeById, applyTheme } from './lib/themes'
import {
  makeLeaf, leaves, findLeaf, updateLeaf, mapLeaves, splitLeaf, removeLeaf, soloLeaf, setSplitSizes,
  type LayoutNode, type OpenTab,
} from './lib/layout'

export function App() {
  const [root, setRoot] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string>('')
  const [entries, setEntries] = useState<FsTreeEntry[]>([])
  const [tree, setTree] = useState<LayoutNode>(() => makeLeaf())
  const [activeLeafId, setActiveLeafId] = useState<string>(() => '')
  const [error, setError] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [themeId, setThemeId] = useState<string>('dark-plus')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Focus the initial leaf on mount.
  useEffect(() => {
    setActiveLeafId(leaves(tree)[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load persisted settings + apply theme.
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
      const t = await window.editorApi.tree(res.root, 1)
      setEntries(t.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Open a file into the focused leaf (or activate it there if already open).
  const openPath = useCallback(async (filePath: string, name: string) => {
    setError(null)
    const leaf = findLeaf(tree, activeLeafId)
    const already = leaf?.tabs.find((t) => t.path === filePath)
    if (already) {
      setTree((prev) => updateLeaf(prev, activeLeafId, (l) => ({ ...l, activePath: filePath })))
      return
    }
    let content: string
    try {
      const res = await window.editorApi.readFile(filePath)
      content = res.content
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    setTree((prev) => updateLeaf(prev, activeLeafId, (l) => {
      const tab: OpenTab = { path: filePath, name, content, savedContent: content }
      return { ...l, tabs: [...l.tabs, tab], activePath: filePath }
    }))
  }, [tree, activeLeafId])

  const openFile = useCallback((entry: FsTreeEntry) => {
    if (entry.type !== 'file') return
    void openPath(entry.path, entry.name)
  }, [openPath])

  const pickQuickOpen = useCallback((entry: FileListEntry) => {
    setQuickOpen(false)
    void openPath(entry.path, entry.name)
  }, [openPath])

  const activateTab = useCallback((leafId: string, path: string) => {
    setActiveLeafId(leafId)
    setTree((prev) => updateLeaf(prev, leafId, (l) => ({ ...l, activePath: path })))
  }, [])

  const changeContent = useCallback((leafId: string, path: string, content: string) => {
    setTree((prev) => updateLeaf(prev, leafId, (l) => ({
      ...l, tabs: l.tabs.map((t) => (t.path === path ? { ...t, content } : t)),
    })))
  }, [])

  const saveTab = useCallback(async (leafId: string, path: string) => {
    const leaf = findLeaf(tree, leafId)
    const tab = leaf?.tabs.find((t) => t.path === path)
    if (!tab) return
    try {
      await window.editorApi.writeFile(tab.path, tab.content)
      // Mark saved in EVERY leaf showing this file (split views stay in sync).
      setTree((prev) => mapLeaves(prev, (l) => ({
        ...l, tabs: l.tabs.map((t) => (t.path === path ? { ...t, savedContent: t.content } : t)),
      })))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tree])

  // Close a tab in a leaf. Closing the LAST tab removes the pane (collapses the split),
  // like VS Code — except the final remaining pane is kept (empty). Never closes the
  // window.
  const closeTab = useCallback((leafId: string, path: string) => {
    setTree((prev) => {
      const leaf = findLeaf(prev, leafId)
      if (!leaf) return prev
      const remaining = leaf.tabs.filter((t) => t.path !== path)
      // Last tab in this pane → remove the pane entirely.
      if (remaining.length === 0) {
        const res = removeLeaf(prev, leafId)
        if (!res) {
          // This was the only pane — keep it, emptied.
          return updateLeaf(prev, leafId, (l) => ({ ...l, tabs: [], activePath: null }))
        }
        setActiveLeafId(res.focusId)
        return res.tree
      }
      // Otherwise just drop the tab and pick a fallback active tab.
      return updateLeaf(prev, leafId, (l) => {
        const idx = l.tabs.findIndex((t) => t.path === path)
        const tabs = l.tabs.filter((t) => t.path !== path)
        let activePath = l.activePath
        if (path === l.activePath) {
          const fallback = tabs[idx] ?? tabs[idx - 1] ?? null
          activePath = fallback ? fallback.path : null
        }
        return { ...l, tabs, activePath }
      })
    })
  }, [])

  // Refs so once-subscribed handlers (menu events, key chords) always read current
  // focus/tree without re-subscribing. Declared before the pane ops that close over them.
  const activeLeafIdRef = useRef('')
  activeLeafIdRef.current = activeLeafId
  const treeRef = useRef(tree)
  treeRef.current = tree

  // --- Pane operations (Emacs chords) ---

  const splitById = useCallback((leafId: string, orientation: 'row' | 'column') => {
    setTree((prev) => {
      const res = splitLeaf(prev, leafId, orientation)
      if (!res) return prev
      setActiveLeafId(res.newLeafId)
      return res.tree
    })
  }, [])

  const splitFocused = useCallback((orientation: 'row' | 'column') => {
    splitById(activeLeafIdRef.current, orientation)
  }, [splitById])

  const closeFocusedPane = useCallback(() => {
    setTree((prev) => {
      const res = removeLeaf(prev, activeLeafIdRef.current)
      if (!res) return prev // was the only (root) pane → keep it
      setActiveLeafId(res.focusId)
      return res.tree
    })
  }, [])

  const soloFocusedPane = useCallback(() => {
    setTree((prev) => soloLeaf(prev, activeLeafIdRef.current))
  }, [])

  const resizeSplit = useCallback((splitId: string, sizes: number[]) => {
    setTree((prev) => setSplitSizes(prev, splitId, sizes))
  }, [])

  const saveFocused = useCallback(() => {
    const leaf = findLeaf(treeRef.current, activeLeafIdRef.current)
    if (leaf?.activePath) void saveTab(leaf.id, leaf.activePath)
  }, [saveTab])

  const closeFocusedTab = useCallback(() => {
    const leaf = findLeaf(treeRef.current, activeLeafIdRef.current)
    if (leaf?.activePath) closeTab(leaf.id, leaf.activePath)
  }, [closeTab])

  // Menu wiring (save / close-tab / quick-open / settings / open-folder).
  useEffect(() => {
    const offOpen = window.editorApi.onMenu('menu:open-folder', () => void openFolder())
    const offSave = window.editorApi.onMenu('menu:save', () => saveFocused())
    const offQuick = window.editorApi.onMenu('menu:quick-open', () => setQuickOpen((v) => !v))
    const offSettings = window.editorApi.onMenu('menu:settings', () => setSettingsOpen((v) => !v))
    const offCloseTab = window.editorApi.onMenu('menu:close-tab', () => closeFocusedTab())
    const offSplit = window.editorApi.onMenu('menu:split', () => splitFocused('row'))
    return () => { offOpen(); offSave(); offQuick(); offSettings(); offCloseTab(); offSplit() }
  }, [openFolder, saveFocused, closeFocusedTab, splitFocused])

  // Emacs-style C-x prefix chord handling for pane commands, plus Cmd+P.
  const prefixRef = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+P quick open (independent of the C-x prefix).
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.altKey) {
        e.preventDefault()
        if (root) setQuickOpen((v) => !v)
        return
      }
      // Arm the C-x prefix.
      if (e.ctrlKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault()
        prefixRef.current = true
        return
      }
      // Second key of the chord.
      if (prefixRef.current) {
        if (e.key === '3') { e.preventDefault(); splitFocused('row') }
        else if (e.key === '2') { e.preventDefault(); splitFocused('column') }
        else if (e.key === '1') { e.preventDefault(); soloFocusedPane() }
        else if (e.key === '0') { e.preventDefault(); closeFocusedPane() }
        // Any key ends the prefix (whether or not it was a pane command).
        prefixRef.current = false
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [root, splitFocused, soloFocusedPane, closeFocusedPane])

  const focusedLeaf = findLeaf(tree, activeLeafId) ?? leaves(tree)[0]
  const focusedTab = focusedLeaf?.tabs.find((t) => t.path === focusedLeaf.activePath) ?? null
  const treeActivePath = focusedLeaf?.activePath ?? null
  const paneCount = leaves(tree).length

  return (
    <div class="shell">
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

      <aside class="sidebar" data-testid="sidebar">
        <div class="sidebar-header">Explorer</div>
        {root ? (
          <>
            <div class="explorer-root">{rootName}</div>
            <FileTree entries={entries} activePath={treeActivePath} onOpenFile={openFile} />
          </>
        ) : (
          <div class="sidebar-empty">
            <p class="hint">You have not yet opened a folder.</p>
            <button class="open-btn" onClick={() => void openFolder()}>Open Folder</button>
          </div>
        )}
      </aside>

      <main class="editor-area">
        {settingsOpen ? (
          <SettingsPanel
            activeTheme={themeId}
            onSelectTheme={selectTheme}
            onClose={() => setSettingsOpen(false)}
          />
        ) : (
          <div class="pane-root">
            <PaneTree
              node={tree}
              activeLeafId={activeLeafId}
              themeId={themeId}
              onFocus={setActiveLeafId}
              onActivateTab={activateTab}
              onCloseTab={closeTab}
              onChangeContent={changeContent}
              onSave={(leafId, path) => void saveTab(leafId, path)}
              onResize={resizeSplit}
            />
          </div>
        )}
      </main>

      <footer class="statusbar" data-testid="statusbar">
        <span class="status-left">
          {root ? rootName : 'No folder'}
          {focusedTab && ` — ${focusedTab.name}${focusedTab.content !== focusedTab.savedContent ? ' ●' : ''}`}
          {paneCount > 1 && `  ·  ${paneCount} panes`}
        </span>
        <span class="status-right">{error ? `⚠ ${error}` : 'khef-editor v0.1.0'}</span>
      </footer>

      {quickOpen && root && (
        <QuickOpen onPick={pickQuickOpen} onClose={() => setQuickOpen(false)} />
      )}
    </div>
  )
}
