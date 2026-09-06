// Parse pytest's `-v` console output (which we already stream into the Debug Console) into
// a structured results list for the Test panel. No extra pytest args or second process:
// the same text that shows in the console drives the panel, and it updates live as chunks
// arrive. Deliberately tolerant — unrecognized lines are ignored.

export type TestOutcome = 'passed' | 'failed' | 'error' | 'skipped'

export interface TestResult {
  nodeid: string        // e.g. "tests/test_friends.py::test_load_pairs_simple"
  file: string          // "tests/test_friends.py"
  name: string          // "test_load_pairs_simple"
  outcome: TestOutcome
  // For a failure: the file:line the traceback pointed at (best-effort) + the summary reason.
  failLine?: number
  failFile?: string
  reason?: string
}

export interface TestRunSummary {
  results: TestResult[]
  passed: number
  failed: number
  errored: number
  skipped: number
  // The trailing "=== N passed in 0.05s ===" line, if seen.
  summaryLine?: string
}

// A `-v` progress line: "path::test[...] OUTCOME". pytest right-pads with spaces / a
// percentage; we only need the head. FAILED/ERROR/PASSED/SKIPPED are the outcomes `-v` prints.
const PROGRESS = /^(\S+?\.py)::(\S+?)\s+(PASSED|FAILED|ERROR|SKIPPED)\b/
// A traceback location line: "path:line: SomeError". Last one before the summary wins per file.
const TRACE_LOC = /^(\S+?\.py):(\d+):\s+\w/
// short-summary reason: "FAILED path::test - reason"
const SUMMARY_REASON = /^(?:FAILED|ERROR)\s+(\S+?::\S+?)\s+-\s+(.*)$/
const TOTALS = /=+\s+(.*?\b\d+\s+(?:passed|failed|error|skipped).*?)\s+=+/

const outcomeMap: Record<string, TestOutcome> = {
  PASSED: 'passed', FAILED: 'failed', ERROR: 'error', SKIPPED: 'skipped',
}

export function parsePytestOutput(text: string): TestRunSummary {
  const lines = text.split('\n')
  const results: TestResult[] = []
  const byNodeid = new Map<string, TestResult>()
  // Track the most recent traceback location seen, to attach to the next failure summary.
  const traceLocs: { file: string; line: number }[] = []
  let summaryLine: string | undefined

  for (const line of lines) {
    const p = PROGRESS.exec(line)
    if (p) {
      const [, file, name, oc] = p
      const r: TestResult = { nodeid: `${file}::${name}`, file, name, outcome: outcomeMap[oc] }
      results.push(r)
      byNodeid.set(r.nodeid, r)
      continue
    }
    const t = TRACE_LOC.exec(line)
    if (t) { traceLocs.push({ file: t[1], line: Number(t[2]) }); continue }
    const s = SUMMARY_REASON.exec(line)
    if (s) {
      const r = byNodeid.get(s[1])
      if (r) r.reason = s[2]
      continue
    }
    const tot = TOTALS.exec(line)
    if (tot) summaryLine = tot[1]
  }

  // Attach traceback locations to failed/errored tests in order (pytest prints one
  // traceback block per failure, in test order, each ending with the `path:line:` line).
  const failed = results.filter((r) => r.outcome === 'failed' || r.outcome === 'error')
  failed.forEach((r, i) => {
    const loc = traceLocs[i]
    if (loc) { r.failFile = loc.file; r.failLine = loc.line }
  })

  return {
    results,
    passed: results.filter((r) => r.outcome === 'passed').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    errored: results.filter((r) => r.outcome === 'error').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    summaryLine,
  }
}
