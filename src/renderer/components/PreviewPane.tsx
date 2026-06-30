import { useEffect, useRef } from 'preact/hooks'
import { previewKindForFilename, renderMarkdown, renderMermaid, renderMermaidFile } from '../lib/preview'

interface PreviewPaneProps {
  sourceName: string   // the source file name (drives markdown vs mermaid)
  content: string      // live source content
  dark: boolean        // theme is dark (for mermaid theming)
  idPrefix: string     // unique per tab, for mermaid element ids
}

// Renders a file's content as a sanitized Markdown/Mermaid preview. All HTML/SVG comes
// from lib/preview, which sanitizes with DOMPurify before it reaches innerHTML here.
export function PreviewPane({ sourceName, content, dark, idPrefix }: PreviewPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Track the latest render so an async mermaid pass can bail if content changed.
  const renderTokenRef = useRef(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const token = ++renderTokenRef.current
    const kind = previewKindForFilename(sourceName)

    if (kind === 'mermaid') {
      host.innerHTML = '<div class="preview-loading">Rendering diagram…</div>'
      void renderMermaidFile(content, idPrefix, dark).then((svg) => {
        if (renderTokenRef.current !== token || !hostRef.current) return
        hostRef.current.innerHTML = svg
      })
      return
    }

    // Markdown (default for previewable text).
    const { html, mermaidBlocks } = renderMarkdown(content, idPrefix)
    host.innerHTML = html
    // Hydrate embedded ```mermaid blocks asynchronously.
    for (const block of mermaidBlocks) {
      void renderMermaid(block.source, block.id, dark).then((svg) => {
        if (renderTokenRef.current !== token || !hostRef.current) return
        const slot = hostRef.current.querySelector(`[data-mermaid-id="${block.id}"]`)
        if (slot) slot.innerHTML = svg
      })
    }
  }, [sourceName, content, dark, idPrefix])

  return <div class="preview-pane" data-testid="preview-pane"><div class="preview-content" ref={hostRef} /></div>
}
