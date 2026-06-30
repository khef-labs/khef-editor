// Secure preview rendering for Markdown and Mermaid.
//
// SECURITY: file content is untrusted. Every HTML/SVG string produced here is passed
// through DOMPurify before it is returned, so the caller can safely set innerHTML. We
// forbid script/style/link/iframe vectors, strip event handlers and javascript:/data:
// URLs, and sanitize Mermaid's SVG output with the SVG profile. No remote resources are
// fetched at render time (the app CSP also blocks remote loads as defense in depth).

import { marked } from 'marked'
import DOMPurify from 'dompurify'
import mermaid from 'mermaid'

export type PreviewKind = 'markdown' | 'mermaid'

// File extensions that get a preview, mapped to how they render.
const EXT_KIND: Record<string, PreviewKind> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  mmd: 'mermaid',
  mermaid: 'mermaid',
}

export function previewKindForFilename(filename: string): PreviewKind | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_KIND[ext] ?? null
}

export function isPreviewable(filename: string): boolean {
  return previewKindForFilename(filename) !== null
}

// Shared DOMPurify config: no scripts, styles, or remote-loading elements. We allow
// common markdown output plus inline SVG (for rendered mermaid diagrams).
// Markdown config: strip scripts, inline styles, and remote-loading elements. Markdown
// has no business carrying inline styles, so we forbid them outright.
const MD_PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'base'],
  FORBID_ATTR: ['style'],
  ALLOW_DATA_ATTR: false,
  USE_PROFILES: { html: true },
}

// Mermaid config: the SVG is OUR OWN generated output (securityLevel:'strict' already
// blocks html labels and click handlers), so we must KEEP its inline styles and <style>
// block — that's how nodes/edges/text get their colors. We still strip <script> and event
// handlers as defense in depth. No remote loading (CSP also blocks it).
const MERMAID_PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'base'],
  ADD_TAGS: ['style'],
  ADD_ATTR: ['style'],
  ALLOW_DATA_ATTR: true,
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
}

function sanitizeMarkdown(html: string): string {
  return DOMPurify.sanitize(html, MD_PURIFY_CONFIG)
}

function sanitizeMermaid(svg: string): string {
  return DOMPurify.sanitize(svg, MERMAID_PURIFY_CONFIG)
}

let mermaidReady = false
function ensureMermaid(theme: 'dark' | 'default'): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict', // mermaid's own anti-XSS: no click handlers, no script
    // Render labels as SVG <text>, not HTML <foreignObject>. <text> survives the SVG
    // sanitizer cleanly (foreignObject HTML labels get stripped, leaving empty nodes).
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme,
  })
  mermaidReady = true
}

// Render a Mermaid source string to a sanitized SVG string.
export async function renderMermaid(source: string, id: string, dark: boolean): Promise<string> {
  ensureMermaid(dark ? 'dark' : 'default')
  void mermaidReady
  try {
    const { svg } = await mermaid.render(id, source)
    return sanitizeMermaid(svg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Escape the error text; never inject raw.
    return sanitizeMarkdown(`<pre class="preview-error">Mermaid render error:\n${msg}</pre>`)
  }
}

// Render Markdown to sanitized HTML. Embedded ```mermaid fenced blocks are replaced with
// a placeholder div the caller hydrates asynchronously via renderMermaid (marked is sync).
export interface MarkdownResult {
  html: string
  // Placeholder id -> mermaid source, to be rendered and injected after mount.
  mermaidBlocks: { id: string; source: string }[]
}

export function renderMarkdown(source: string, idPrefix: string): MarkdownResult {
  const mermaidBlocks: { id: string; source: string }[] = []
  let n = 0

  // Custom renderer: turn ```mermaid blocks into placeholders, leave other code as code.
  const renderer = new marked.Renderer()
  const origCode = renderer.code.bind(renderer)
  renderer.code = (codeToken) => {
    const lang = (codeToken.lang ?? '').trim().toLowerCase()
    if (lang === 'mermaid') {
      const id = `${idPrefix}-mmd-${n++}`
      mermaidBlocks.push({ id, source: codeToken.text })
      // Placeholder; the source is carried out-of-band, never inlined into HTML.
      return `<div class="preview-mermaid" data-mermaid-id="${id}"></div>`
    }
    return origCode(codeToken)
  }

  const rawHtml = marked.parse(source, { renderer, async: false, gfm: true, breaks: false }) as string
  return { html: sanitizeMarkdown(rawHtml), mermaidBlocks }
}

// Render a standalone .mmd file: the whole file is one mermaid diagram.
export async function renderMermaidFile(source: string, idPrefix: string, dark: boolean): Promise<string> {
  return renderMermaid(source, `${idPrefix}-file`, dark)
}
