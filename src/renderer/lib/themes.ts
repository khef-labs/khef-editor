// Theme presets. Each theme supplies the UI CSS-variable palette (matching the names
// used in styles.css) plus an editor theme key consumed by CodeEditor to pick a
// CodeMirror theme. Applying a theme sets the vars on :root — no rebuild needed.

export type EditorThemeKey = 'one-dark' | 'light' | 'monokai' | 'solarized-dark' | 'github-dark'

export interface Theme {
  id: string
  name: string
  editorTheme: EditorThemeKey
  vars: Record<string, string>
}

// The CSS-variable contract used across styles.css.
const VAR_KEYS = [
  '--bg', '--bg-sidebar', '--bg-activity', '--bg-tab-inactive', '--bg-tab-active',
  '--bg-statusbar', '--statusbar-bg', '--statusbar-fg', '--border', '--border-soft',
  '--fg', '--fg-dim', '--fg-bright', '--accent', '--row-hover', '--row-active',
  '--scrollbar-thumb', '--scrollbar-thumb-hover', '--active-line', '--cursor-overview',
] as const

export const THEMES: Theme[] = [
  {
    id: 'dark-plus',
    name: 'Dark+ (default)',
    editorTheme: 'one-dark',
    vars: {
      '--bg': '#1e1e1e', '--bg-sidebar': '#252526', '--bg-activity': '#333333',
      '--bg-tab-inactive': '#2d2d2d', '--bg-tab-active': '#1e1e1e', '--bg-statusbar': '#007acc',
      '--statusbar-bg': '#181818', '--statusbar-fg': '#cccccc',
      '--border': '#1b1b1b', '--border-soft': '#2b2b2b', '--fg': '#cccccc',
      '--fg-dim': '#8c8c8c', '--fg-bright': '#ffffff', '--accent': '#0e639c',
      '--row-hover': '#2a2d2e', '--row-active': '#094771',
      '--scrollbar-thumb': '#424242', '--scrollbar-thumb-hover': '#5a5a5a', '--active-line': '#323842', '--cursor-overview': '#a0a0a0',
    },
  },
  {
    id: 'light-plus',
    name: 'Light+',
    editorTheme: 'light',
    vars: {
      '--bg': '#ffffff', '--bg-sidebar': '#f3f3f3', '--bg-activity': '#2c2c2c',
      '--bg-tab-inactive': '#ececec', '--bg-tab-active': '#ffffff', '--bg-statusbar': '#007acc',
      '--statusbar-bg': '#f3f3f3', '--statusbar-fg': '#3b3b3b',
      '--border': '#e0e0e0', '--border-soft': '#eaeaea', '--fg': '#1f1f1f',
      '--fg-dim': '#6a6a6a', '--fg-bright': '#000000', '--accent': '#0066b8',
      '--row-hover': '#e8e8e8', '--row-active': '#cde3f8',
      '--scrollbar-thumb': '#c1c1c1', '--scrollbar-thumb-hover': '#a0a0a0', '--active-line': '#d4dae1', '--cursor-overview': '#6a6a6a',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    editorTheme: 'monokai',
    vars: {
      '--bg': '#272822', '--bg-sidebar': '#1e1f1c', '--bg-activity': '#1a1b17',
      '--bg-tab-inactive': '#2d2e28', '--bg-tab-active': '#272822', '--bg-statusbar': '#a6e22e',
      '--statusbar-bg': '#1a1b17', '--statusbar-fg': '#cfcfc2',
      '--border': '#1a1b17', '--border-soft': '#33342c', '--fg': '#f8f8f2',
      '--fg-dim': '#a59f85', '--fg-bright': '#ffffff', '--accent': '#fd971f',
      '--row-hover': '#34352d', '--row-active': '#49483e',
      '--scrollbar-thumb': '#4a4b42', '--scrollbar-thumb-hover': '#5f6055', '--active-line': '#3c3d33', '--cursor-overview': '#a6a28c',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    editorTheme: 'solarized-dark',
    vars: {
      '--bg': '#002b36', '--bg-sidebar': '#073642', '--bg-activity': '#04303a',
      '--bg-tab-inactive': '#073642', '--bg-tab-active': '#002b36', '--bg-statusbar': '#2aa198',
      '--statusbar-bg': '#04222b', '--statusbar-fg': '#93a1a1',
      '--border': '#04303a', '--border-soft': '#0a3d49', '--fg': '#93a1a1',
      '--fg-dim': '#657b83', '--fg-bright': '#fdf6e3', '--accent': '#268bd2',
      '--row-hover': '#0a3d49', '--row-active': '#14545f',
      '--scrollbar-thumb': '#0e4a57', '--scrollbar-thumb-hover': '#156270', '--active-line': '#073f4d', '--cursor-overview': '#5a7a82',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    editorTheme: 'github-dark',
    vars: {
      '--bg': '#0d1117', '--bg-sidebar': '#161b22', '--bg-activity': '#0d1117',
      '--bg-tab-inactive': '#161b22', '--bg-tab-active': '#0d1117', '--bg-statusbar': '#1f6feb',
      '--statusbar-bg': '#0d1117', '--statusbar-fg': '#8b949e',
      '--border': '#21262d', '--border-soft': '#30363d', '--fg': '#c9d1d9',
      '--fg-dim': '#8b949e', '--fg-bright': '#f0f6fc', '--accent': '#1f6feb',
      '--row-hover': '#161b22', '--row-active': '#1f2937',
      '--scrollbar-thumb': '#30363d', '--scrollbar-thumb-hover': '#484f58', '--active-line': '#1f2733', '--cursor-overview': '#7d8590',
    },
  },
]

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const key of VAR_KEYS) {
    const v = theme.vars[key]
    if (v) root.style.setProperty(key, v)
  }
}
