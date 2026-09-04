import { useEffect, useRef } from 'preact/hooks'

export interface ConsoleChunk {
  channel: 'stdout' | 'stderr' | 'status'
  text: string
}

// Debug Console: read-only program output (stdout/stderr from the debuggee, plus status
// lines like the exit code). Auto-follows the tail unless the user has scrolled up.
export function ConsolePane({ chunks }: { chunks: ConsoleChunk[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [chunks])

  return (
    <div class="console-pane" ref={scrollRef} onScroll={onScroll} data-testid="console-pane">
      {chunks.length === 0 && <div class="console-empty">No output yet — run or debug a Python file.</div>}
      <div class="console-text">
        {chunks.map((c, i) => (
          <span key={i} class={`console-${c.channel}`}>{c.text}</span>
        ))}
      </div>
    </div>
  )
}
