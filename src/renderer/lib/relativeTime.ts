// "3 hours ago" style labels for commit dates. Coarse on purpose — a review page wants
// "2d ago", not a timestamp; the full date lives in the tooltip.

const MIN = 60, HOUR = 3600, DAY = 86400, WEEK = 7 * DAY, MONTH = 30 * DAY, YEAR = 365 * DAY

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 45) return 'just now'
  if (s < HOUR) return `${Math.max(1, Math.round(s / MIN))}m ago`
  if (s < DAY) return `${Math.round(s / HOUR)}h ago`
  if (s < WEEK) return `${Math.round(s / DAY)}d ago`
  if (s < MONTH) return `${Math.round(s / WEEK)}w ago`
  if (s < YEAR) return `${Math.round(s / MONTH)}mo ago`
  return `${Math.round(s / YEAR)}y ago`
}
