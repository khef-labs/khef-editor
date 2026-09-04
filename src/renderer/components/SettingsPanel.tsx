import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { Check } from 'lucide-preact'
import { THEMES } from '../lib/themes'

interface SettingsPanelProps {
  activeTheme: string
  onSelectTheme: (id: string) => void
  onClose: () => void
}

// One debugger-binary path override (pythonPath / rdbgPath). Saved on blur/Enter; blank
// = automatic resolution. Kept generic so new adapters add a row, not a component.
function DebugBinarySetting({ settingKey, label, placeholder, help, testId }: {
  settingKey: 'pythonPath' | 'rdbgPath'
  label: string
  placeholder: string
  help: ComponentChildren
  testId: string
}) {
  const [value, setValue] = useState<string | null>(null) // null until settings load
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void window.editorApi.getSettings().then((s) => setValue(s[settingKey] ?? ''))
  }, [settingKey])

  const save = (next: string) => {
    void window.editorApi.setSettings({ [settingKey]: next.trim() }).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  if (value === null) return null
  return (
    <div class="settings-field">
      <label class="settings-label">{label}</label>
      <p class="settings-desc">{help}</p>
      <div class="settings-input-row">
        <input
          class="settings-input"
          type="text"
          placeholder={placeholder}
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onBlur={() => save(value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(value) }}
          data-testid={testId}
        />
        {saved && <span class="settings-saved">Saved</span>}
      </div>
    </div>
  )
}

function DebuggingSettings() {
  return (
    <section class="settings-section">
      <h3>Debugging</h3>
      <DebugBinarySetting
        settingKey="pythonPath"
        label="Python interpreter"
        placeholder="auto (.venv/bin/python, else python3)"
        testId="python-path-input"
        help={<>Runs and debugs <code>.py</code> files. Blank = automatic: the workspace's <code>.venv/bin/python</code> when present, else <code>python3</code>. Debug sessions need <code>debugpy</code> installed in it.</>}
      />
      <DebugBinarySetting
        settingKey="rdbgPath"
        label="Ruby debugger (rdbg)"
        placeholder="auto (login-shell rdbg)"
        testId="rdbg-path-input"
        help={<>Runs and debugs <code>.rb</code> files. Blank = automatic: <code>rdbg</code> resolved via your login shell (so rvm/rbenv work). Needs the <code>debug</code> gem (<code>gem install debug</code>).</>}
      />
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

      <DebuggingSettings />
    </div>
  )
}
