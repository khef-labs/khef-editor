import { X, Circle } from 'lucide-preact'
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
}

export function TabBar({ tabs, activePath, onActivate, onClose, onPromote, onContextMenu }: TabBarProps) {
  if (tabs.length === 0) return null
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
    </div>
  )
}
