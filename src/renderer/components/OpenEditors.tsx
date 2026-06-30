import { useState } from 'preact/hooks'
import { ChevronRight, ChevronDown, X } from 'lucide-preact'
import type { LeafNode } from '../lib/layout'

interface OpenEditorsProps {
  leaves: LeafNode[]
  activeLeafId: string
  onActivate: (leafId: string, path: string) => void
  onClose: (leafId: string, path: string) => void
}

// VS Code's "Open Editors": every open tab across every pane. A file open in two splits
// shows twice (one row per editor), each with its own dirty state and close button.
export function OpenEditors({ leaves, activeLeafId, onActivate, onClose }: OpenEditorsProps) {
  const [collapsed, setCollapsed] = useState(false)
  const withTabs = leaves.filter((l) => l.tabs.length > 0)
  const total = withTabs.reduce((n, l) => n + l.tabs.length, 0)
  if (total === 0) return null

  const showGroups = withTabs.length > 1

  return (
    <div class="open-editors" data-testid="open-editors">
      <button class="open-editors-header" onClick={() => setCollapsed((v) => !v)}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span class="open-editors-title">Open Editors</span>
      </button>
      {!collapsed && withTabs.map((leaf, gi) => (
        <div key={leaf.id} class="open-editors-group">
          {showGroups && <div class="open-editors-group-label">Group {gi + 1}</div>}
          {leaf.tabs.map((tab) => {
            const dirty = tab.content !== tab.savedContent
            const isActive = leaf.id === activeLeafId && leaf.activePath === tab.path
            const dir = tab.path.slice(0, tab.path.length - tab.name.length - 1)
            return (
              <div
                key={tab.path}
                class={`open-editor-row${isActive ? ' active' : ''}`}
                onClick={() => onActivate(leaf.id, tab.path)}
                title={tab.path}
              >
                <button
                  class={`open-editor-close${dirty ? ' dirty' : ''}`}
                  title={dirty ? 'Unsaved — click to close' : 'Close'}
                  onClick={(e) => { e.stopPropagation(); onClose(leaf.id, tab.path) }}
                >
                  <X size={13} class="x-icon" />
                  <span class="dirty-dot" />
                </button>
                <span class="open-editor-name">{tab.name}</span>
                {dir && <span class="open-editor-dir">{dir}</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
