import { Check } from 'lucide-preact'
import { THEMES } from '../lib/themes'

interface SettingsPanelProps {
  activeTheme: string
  onSelectTheme: (id: string) => void
  onClose: () => void
}

export function SettingsPanel({ activeTheme, onSelectTheme, onClose }: SettingsPanelProps) {
  return (
    <div class="settings" data-testid="settings-panel">
      <div class="settings-header">
        <span>Settings</span>
        <button class="settings-close" onClick={onClose}>✕</button>
      </div>

      <section class="settings-section">
        <h3>Color Theme</h3>
        <p class="settings-desc">Choose a color scheme for the editor and UI.</p>
        <ul class="theme-list">
          {THEMES.map((t) => (
            <li
              key={t.id}
              class={`theme-row${t.id === activeTheme ? ' active' : ''}`}
              onClick={() => onSelectTheme(t.id)}
              data-testid={`theme-${t.id}`}
            >
              <span class="theme-swatches">
                <span class="sw" style={{ background: t.vars['--bg'] }} />
                <span class="sw" style={{ background: t.vars['--bg-sidebar'] }} />
                <span class="sw" style={{ background: t.vars['--accent'] }} />
                <span class="sw" style={{ background: t.vars['--bg-statusbar'] }} />
              </span>
              <span class="theme-name">{t.name}</span>
              {t.id === activeTheme && <Check size={15} class="theme-check" />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
