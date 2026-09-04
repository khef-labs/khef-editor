import { useEffect, useState } from 'preact/hooks'
import { Check } from 'lucide-preact'
import { THEMES } from '../lib/themes'

interface SettingsPanelProps {
  activeTheme: string
  onSelectTheme: (id: string) => void
  onClose: () => void
}

// Debugger interpreter override. Saved on blur/Enter; blank = automatic resolution
// (workspace .venv/bin/python, else python3 from PATH).
function PythonPathSetting() {
  const [value, setValue] = useState<string | null>(null) // null until settings load
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void window.editorApi.getSettings().then((s) => setValue(s.pythonPath ?? ''))
  }, [])

  const save = (next: string) => {
    void window.editorApi.setSettings({ pythonPath: next.trim() }).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  if (value === null) return null
  return (
    <section class="settings-section">
      <h3>Python Debugging</h3>
      <p class="settings-desc">
        Interpreter used to run and debug Python files. Leave blank for automatic:
        the workspace's <code>.venv/bin/python</code> when present, else <code>python3</code>.
        Debug sessions need <code>debugpy</code> installed in that interpreter.
      </p>
      <div class="settings-input-row">
        <input
          class="settings-input"
          type="text"
          placeholder="auto (.venv/bin/python, else python3)"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onBlur={() => save(value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(value) }}
          data-testid="python-path-input"
        />
        {saved && <span class="settings-saved">Saved</span>}
      </div>
    </section>
  )
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

      <PythonPathSetting />
    </div>
  )
}
