import { TabBar } from './TabBar'
import { CodeEditor } from './CodeEditor'
import { PreviewPane } from './PreviewPane'
import { DiffView } from './DiffView'
import type { EditorGroup } from '../lib/editorGroups'
import type { TabDragSource } from '../lib/tabDrag'
import { themeById } from '../lib/themes'

interface EditorGroupViewProps {
  group: EditorGroup
  isFocused: boolean
  themeId: string
  gotoLine?: { path: string; line: number; token: number } | null
  // Debugging: breakpoint lines per absolute file path, gutter-click toggle, and where
  // execution is stopped (highlight shown only in the matching file's editor).
  breakpoints: Map<string, number[]>
  onToggleBreakpoint: (path: string, line: number) => void
  debugStopped: { path: string; line: number } | null
  onFocus: () => void
  onActivateTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChangeContent: (path: string, content: string) => void
  onUserEdit: (path: string) => void
  onPromoteTab: (path: string) => void
  onTabContextMenu: (path: string, e: MouseEvent) => void
  onPreviewTab: (path: string) => void
  onSplitRightTab: (path: string) => void
  onDropTab: (from: TabDragSource, toGap: number) => void
  onSave: (path: string, content?: string) => void
  onOpenFolder?: () => void
  onOpenFile?: () => void
  onOpenSettings?: () => void
  recentFolders?: string[]
  onOpenRecent?: (dir: string) => void
  recentFiles?: string[]
  onOpenRecentFile?: (filePath: string) => void
}

export function EditorGroupView({
  group, isFocused, themeId, gotoLine, breakpoints, onToggleBreakpoint, debugStopped,
  onFocus, onActivateTab, onCloseTab, onChangeContent, onUserEdit, onPromoteTab, onTabContextMenu, onPreviewTab, onSplitRightTab, onDropTab, onSave,
  onOpenFolder, onOpenFile, onOpenSettings, recentFolders, onOpenRecent, recentFiles, onOpenRecentFile,
}: EditorGroupViewProps) {
  const activeTab = group.tabs.find((t) => t.path === group.activePath) ?? null

  return (
    <section
      class={`editor-group${isFocused ? ' focused' : ''}`}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
      data-testid={`editor-group-${group.id}`}
    >
      <TabBar
        groupId={group.id}
        tabs={group.tabs}
        activePath={group.activePath}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onPromote={onPromoteTab}
        onContextMenu={onTabContextMenu}
        onPreview={() => { if (activeTab) onPreviewTab(activeTab.path) }}
        onSplitRight={() => { if (activeTab) onSplitRightTab(activeTab.path) }}
        onMore={(e) => { if (activeTab) onTabContextMenu(activeTab.path, e) }}
        onDropTab={onDropTab}
      />
      <div class="editor-body">
        {activeTab ? (
          activeTab.kind === 'preview' ? (
            <PreviewPane
              sourceName={activeTab.sourcePath ? (activeTab.sourcePath.split('/').pop() ?? activeTab.name) : activeTab.name}
              content={activeTab.content}
              dark={themeId !== 'light-plus'}
              idPrefix={activeTab.path.replace(/[^a-zA-Z0-9]/g, '-')}
            />
          ) : activeTab.kind === 'diff' && activeTab.diff ? (
            <DiffView spec={activeTab.diff} />
          ) : (
            <CodeEditor
              path={activeTab.path}
              filename={activeTab.name}
              value={activeTab.content}
              themeKey={themeById(themeId).editorTheme}
              gotoLine={gotoLine && gotoLine.path === activeTab.path ? { line: gotoLine.line, token: gotoLine.token } : null}
              breakpoints={breakpoints.get(activeTab.path)}
              onToggleBreakpoint={(line) => onToggleBreakpoint(activeTab.path, line)}
              stoppedLine={debugStopped && debugStopped.path === activeTab.path ? debugStopped.line : null}
              onChange={(content) => onChangeContent(activeTab.path, content)}
              onUserEdit={() => onUserEdit(activeTab.path)}
              onSave={(content) => onSave(activeTab.path, content)}
            />
          )
        ) : (
          <WelcomePane onOpenFolder={onOpenFolder} onOpenFile={onOpenFile} onOpenSettings={onOpenSettings} recentFolders={recentFolders} onOpenRecent={onOpenRecent} recentFiles={recentFiles} onOpenRecentFile={onOpenRecentFile} />
        )}
      </div>
    </section>
  )
}

function WelcomePane({ onOpenFolder, onOpenFile, onOpenSettings, recentFolders, onOpenRecent, recentFiles, onOpenRecentFile }: {
  onOpenFolder?: () => void; onOpenFile?: () => void; onOpenSettings?: () => void
  recentFolders?: string[]; onOpenRecent?: (dir: string) => void
  recentFiles?: string[]; onOpenRecentFile?: (filePath: string) => void
}) {
  // Actions that make sense before a folder is open.
  const rows: { label: string; keys: string[]; onClick?: () => void }[] = [
    { label: 'Open File', keys: ['⌘', 'O'], onClick: onOpenFile },
    { label: 'Open Folder', keys: ['⇧', '⌘', 'O'], onClick: onOpenFolder },
    { label: 'Settings', keys: ['⌘', ','], onClick: onOpenSettings },
  ]
  const recents = (recentFolders ?? []).slice(0, 8)
  const recentFileRows = (recentFiles ?? []).slice(0, 6)
  const home = '/Users/'
  const pretty = (p: string) => {
    const name = p.split('/').filter(Boolean).pop() ?? p
    const dir = p.startsWith(home) ? '~' + p.slice(p.indexOf('/', 6)) : p
    return { name, dir: dir.slice(0, dir.length - name.length - 1) }
  }
  return (
    <div class="editor-empty" data-testid="welcome-pane">
      <div class="welcome-watermark" aria-hidden="true">K</div>
      <ul class="welcome-shortcuts">
        {rows.map((r) => (
          <li key={r.label}>
            <button class="welcome-row" disabled={!r.onClick} onClick={r.onClick}>
              <span class="welcome-label">{r.label}</span>
              <span class="welcome-keys">
                {r.keys.map((k, i) => <kbd key={i} class="welcome-key">{k}</kbd>)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {recents.length > 0 && (
        <div class="welcome-recent">
          <div class="welcome-recent-title">Recent</div>
          <ul class="welcome-recent-list">
            {recents.map((p) => {
              const { name, dir } = pretty(p)
              return (
                <li key={p}>
                  <button class="welcome-recent-row" title={p} onClick={() => onOpenRecent?.(p)}>
                    <span class="welcome-recent-name">{name}</span>
                    <span class="welcome-recent-dir">{dir}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {recentFileRows.length > 0 && (
        <div class="welcome-recent">
          <div class="welcome-recent-title">Recent Files</div>
          <ul class="welcome-recent-list">
            {recentFileRows.map((p) => {
              const { name, dir } = pretty(p)
              return (
                <li key={p}>
                  <button class="welcome-recent-row" title={p} onClick={() => onOpenRecentFile?.(p)}>
                    <span class="welcome-recent-name">{name}</span>
                    <span class="welcome-recent-dir">{dir}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
