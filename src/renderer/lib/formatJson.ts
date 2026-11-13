export function formatJson(source: string): string {
  const formatted = JSON.stringify(JSON.parse(source), null, 2)
  return formatted + (source.endsWith('\n') ? '\n' : '')
}
