import { X, Circle } from 'lucide-preact'
import type { OpenTab } from '../lib/editorGroups'

export type { OpenTab }

interface TabBarProps {
  tabs: OpenTab[]
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
}

export function TabBar({ tabs, activePath, onActivate, onClose }: TabBarProps) {
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
              class={`tab${active ? ' active' : ''}`}
              onClick={() => onActivate(t.path)}
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
