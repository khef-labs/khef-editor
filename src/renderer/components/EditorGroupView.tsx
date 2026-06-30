import { TabBar } from './TabBar'
import { CodeEditor } from './CodeEditor'
import type { EditorGroup } from '../lib/editorGroups'
import { themeById } from '../lib/themes'

interface EditorGroupViewProps {
  group: EditorGroup
  isFocused: boolean
  themeId: string
  onFocus: () => void
  onActivateTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChangeContent: (path: string, content: string) => void
  onSave: (path: string) => void
}

export function EditorGroupView({
  group, isFocused, themeId,
  onFocus, onActivateTab, onCloseTab, onChangeContent, onSave,
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
            onChange={(content) => onChangeContent(activeTab.path, content)}
            onSave={() => onSave(activeTab.path)}
          />
        ) : (
          <div class="editor-empty">
            <p class="big-logo">⌘</p>
            <p class="hint">Open a file from the Explorer to start editing.</p>
          </div>
        )}
      </div>
    </section>
  )
}
