import { TabBar } from './TabBar'
import { CodeEditor } from './CodeEditor'
import { PreviewPane } from './PreviewPane'
import { DiffView } from './DiffView'
import type { EditorGroup } from '../lib/editorGroups'
import { themeById } from '../lib/themes'

interface EditorGroupViewProps {
  group: EditorGroup
  isFocused: boolean
  themeId: string
  gotoLine?: { path: string; line: number; token: number } | null
  onFocus: () => void
  onActivateTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChangeContent: (path: string, content: string) => void
  onUserEdit: (path: string) => void
  onPromoteTab: (path: string) => void
  onTabContextMenu: (path: string, e: MouseEvent) => void
  onSave: (path: string) => void
  onOpenFolder?: () => void
  onOpenFile?: () => void
  onOpenSettings?: () => void
  recentFolders?: string[]
  onOpenRecent?: (dir: string) => void
}

export function EditorGroupView({
  group, isFocused, themeId, gotoLine,
  onFocus, onActivateTab, onCloseTab, onChangeContent, onUserEdit, onPromoteTab, onTabContextMenu, onSave,
  onOpenFolder, onOpenFile, onOpenSettings, recentFolders, onOpenRecent,
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
        tabs={group.tabs}
        activePath={group.activePath}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onPromote={onPromoteTab}
        onContextMenu={onTabContextMenu}
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
              onChange={(content) => onChangeContent(activeTab.path, content)}
              onUserEdit={() => onUserEdit(activeTab.path)}
              onSave={() => onSave(activeTab.path)}
            />
          )
        ) : (
          <WelcomePane onOpenFolder={onOpenFolder} onOpenFile={onOpenFile} onOpenSettings={onOpenSettings} recentFolders={recentFolders} onOpenRecent={onOpenRecent} />
        )}
      </div>
    </section>
  )
}

function WelcomePane({ onOpenFolder, onOpenFile, onOpenSettings, recentFolders, onOpenRecent }: {
  onOpenFolder?: () => void; onOpenFile?: () => void; onOpenSettings?: () => void
  recentFolders?: string[]; onOpenRecent?: (dir: string) => void
}) {
  // Actions that make sense before a folder is open.
  const rows: { label: string; keys: string[]; onClick?: () => void }[] = [
    { label: 'Open File', keys: ['⌘', 'O'], onClick: onOpenFile },
    { label: 'Open Folder', keys: ['⇧', '⌘', 'O'], onClick: onOpenFolder },
    { label: 'Settings', keys: ['⌘', ','], onClick: onOpenSettings },
  ]
  const recents = (recentFolders ?? []).slice(0, 8)
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
    </div>
  )
}
