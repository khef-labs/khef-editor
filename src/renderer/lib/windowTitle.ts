// Native window title. Electron mirrors document.title into the title bar, so the
// open folder stays visible even on tabs with no file path (Search, Diff, Settings).
export function windowTitle(rootName: string): string {
  return rootName ? `Khef Editor — ${rootName}` : 'Khef Editor'
}
