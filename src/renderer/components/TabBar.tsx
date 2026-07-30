import { X, Circle, Eye, SquareSplitHorizontal, Ellipsis } from 'lucide-preact'
import { isPreviewable } from '../lib/preview'
import type { OpenTab } from '../lib/editorGroups'

export type { OpenTab }

interface TabBarProps {
  tabs: OpenTab[]
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  // Double-clicking an ephemeral (preview) tab promotes it to a permanent tab.
  onPromote: (path: string) => void
  // Right-click → tab context menu (position taken from the mouse event).
  onContextMenu: (path: string, e: MouseEvent) => void
  // Title-bar actions (right side of the tab row), acting on the ACTIVE tab.
  onPreview: () => void
  onSplitRight: () => void
  onMore: (e: MouseEvent) => void
}

export function TabBar({ tabs, activePath, onActivate, onClose, onPromote, onContextMenu, onPreview, onSplitRight, onMore }: TabBarProps) {
  if (tabs.length === 0) return null
  const active = tabs.find((t) => t.path === activePath) ?? null
  const isEditorTab = !!active && (active.kind === undefined || active.kind === 'editor')
  const canPreview = isEditorTab && !!active && isPreviewable(active.name)
  return (
    <div class="tabbar" data-testid="tabbar">
      <div class="tabbar-tabs">
        {tabs.map((t) => {
          const dirty = t.content !== t.savedContent
          const active = t.path === activePath
          return (
            <div
              key={t.path}
              class={`tab${active ? ' active' : ''}${t.ephemeral ? ' ephemeral' : ''}`}
              onClick={() => onActivate(t.path)}
              onDblClick={() => onPromote(t.path)}
              onContextMenu={(e) => { e.preventDefault(); onContextMenu(t.path, e) }}
              data-testid={`tab-${t.name}`}
            >
              <span class="tab-name">{t.name}</span>
              <span
                class="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.path)
                }}
              >
                {dirty ? <Circle size={9} fill="currentColor" /> : <X size={13} />}
              </span>
            </div>
          )
        })}
      </div>
      <div class="tabbar-actions">
        <button class="tabbar-action" title="Open Preview to the Side" disabled={!canPreview} onClick={onPreview}>
          <Eye size={16} />
        </button>
        <button class="tabbar-action" title="Split Editor Right" disabled={!active} onClick={onSplitRight}>
          <SquareSplitHorizontal size={16} />
        </button>
        <button class="tabbar-action" title="More Actions…" disabled={!active} onClick={(e) => onMore(e)}>
          <Ellipsis size={16} />
        </button>
      </div>
    </div>
  )
}
