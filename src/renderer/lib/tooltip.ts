// Custom hover tooltips. Native `title` tooltips are slow and unreliable inside
// Electron, so elements opt in with `data-tooltip="text"` and one delegated listener
// pair per window shows a styled fixed-position div instead. A single tooltip element
// serves the whole window; it has pointer-events:none so it never steals the mouse.

const SHOW_DELAY = 350
// After one tooltip hides, another shown within this window appears instantly, so
// sweeping along a tab strip doesn't re-wait the delay at every tab (VS Code behavior).
const WARM_MS = 600
const OFFSET = 6
const MARGIN = 8

export interface Box { width: number; height: number }
export interface TargetRect { left: number; top: number; right: number; bottom: number }
export type TooltipPlacement = 'below' | 'right'

// 'below' (default): under the target, clamped inside the viewport, flipping above when
// there's no room underneath. 'right' (sidebar rows): beside the target, vertically
// centered on it — set via data-tooltip-placement="right". Pure for testability.
export function tooltipPosition(target: TargetRect, tip: Box, viewport: Box, placement: TooltipPlacement = 'below'): { left: number; top: number } {
  if (placement === 'right') {
    const left = Math.max(MARGIN, Math.min(target.right + OFFSET, viewport.width - tip.width - MARGIN))
    const mid = (target.top + target.bottom) / 2
    const top = Math.max(MARGIN, Math.min(mid - tip.height / 2, viewport.height - tip.height - MARGIN))
    return { left, top }
  }
  const left = Math.max(MARGIN, Math.min(target.left, viewport.width - tip.width - MARGIN))
  let top = target.bottom + OFFSET
  if (top + tip.height + MARGIN > viewport.height) top = target.top - tip.height - OFFSET
  return { left, top }
}

export function installTooltips(): () => void {
  let tip: HTMLDivElement | null = null
  let current: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastHidden = 0

  const ensure = (): HTMLDivElement => {
    if (!tip) {
      tip = document.createElement('div')
      tip.className = 'app-tooltip'
      tip.setAttribute('role', 'tooltip')
      document.body.appendChild(tip)
    }
    return tip
  }

  const hide = () => {
    if (timer) { clearTimeout(timer); timer = undefined }
    if (tip && tip.style.display === 'block') { tip.style.display = 'none'; lastHidden = Date.now() }
    current = null
  }

  const show = (target: HTMLElement, text: string) => {
    const el = ensure()
    el.textContent = text
    // Render invisibly first: positioning needs the tooltip's own size.
    el.style.display = 'block'
    el.style.visibility = 'hidden'
    const placement: TooltipPlacement = target.dataset.tooltipPlacement === 'right' ? 'right' : 'below'
    const { left, top } = tooltipPosition(
      target.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    )
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = 'visible'
  }

  const onOver = (e: MouseEvent) => {
    // Nearest opted-in OR natively-titled ancestor wins: a `title`d child (e.g. a tab's
    // close button) suppresses its parent's custom tooltip instead of showing both.
    const hit = (e.target as HTMLElement | null)?.closest?.('[data-tooltip], [title]') as HTMLElement | null
    const target = hit?.dataset.tooltip ? hit : null
    if (target === current) return
    hide()
    if (!target) return
    current = target
    const text = target.dataset.tooltip as string
    const delay = Date.now() - lastHidden < WARM_MS ? 0 : SHOW_DELAY
    timer = setTimeout(() => show(target, text), delay)
  }

  const onOut = (e: MouseEvent) => {
    if (!current) return
    const to = e.relatedTarget as Node | null
    if (!to || !current.contains(to)) hide()
  }

  document.addEventListener('mouseover', onOver)
  document.addEventListener('mouseout', onOut)
  document.addEventListener('mousedown', hide, true)
  document.addEventListener('dragstart', hide, true)
  document.addEventListener('scroll', hide, true)
  document.addEventListener('wheel', hide, { capture: true, passive: true })
  window.addEventListener('blur', hide)

  return () => {
    hide()
    document.removeEventListener('mouseover', onOver)
    document.removeEventListener('mouseout', onOut)
    document.removeEventListener('mousedown', hide, true)
    document.removeEventListener('dragstart', hide, true)
    document.removeEventListener('scroll', hide, true)
    document.removeEventListener('wheel', hide, { capture: true } as EventListenerOptions)
    window.removeEventListener('blur', hide)
    tip?.remove()
    tip = null
  }
}
