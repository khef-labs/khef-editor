import { TabBar } from './TabBar'
import { CodeEditor } from './CodeEditor'
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
  onSave: (path: string) => void
  onOpenFolder?: () => void
  onOpenSettings?: () => void
}

export function EditorGroupView({
  group, isFocused, themeId, gotoLine,
  onFocus, onActivateTab, onCloseTab, onChangeContent, onSave,
  onOpenFolder, onOpenSettings,
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
      />
      <div class="editor-body">
        {activeTab ? (
          <CodeEditor
            path={activeTab.path}
            filename={activeTab.name}
            value={activeTab.content}
            themeKey={themeById(themeId).editorTheme}
            gotoLine={gotoLine && gotoLine.path === activeTab.path ? { line: gotoLine.line, token: gotoLine.token } : null}
            onChange={(content) => onChangeContent(activeTab.path, content)}
            onSave={() => onSave(activeTab.path)}
          />
        ) : (
          <WelcomePane onOpenFolder={onOpenFolder} onOpenSettings={onOpenSettings} />
        )}
      </div>
    </section>
  )
}

function WelcomePane({ onOpenFolder, onOpenSettings }: { onOpenFolder?: () => void; onOpenSettings?: () => void }) {
  // Only actions that make sense before a folder is open. "Open File" has no command
  // yet, so it's shown disabled; Settings opens the panel.
  const rows: { label: string; keys: string[]; onClick?: () => void }[] = [
    { label: 'Open Folder', keys: ['⌘', 'O'], onClick: onOpenFolder },
    { label: 'Open File', keys: [] },
    { label: 'Settings', keys: ['⌘', ','], onClick: onOpenSettings },
  ]
  return (
    <div class="editor-empty" data-testid="welcome-pane">
      <div class="welcome-watermark" aria-hidden="true">K</div>
      <ul class="welcome-shortcuts">
        {rows.map((r) => (
          <li key={r.label}>
            <button
              class="welcome-row"
              disabled={!r.onClick}
              onClick={r.onClick}
            >
              <span class="welcome-label">{r.label}</span>
              <span class="welcome-keys">
                {r.keys.map((k, i) => <kbd key={i} class="welcome-key">{k}</kbd>)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
