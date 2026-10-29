// Background jobs: the project's tests, named jobs from .claude/kokpit.json and any shell command.
// Pure functions only: building the argv, reading progress from output, formatting.

import type { Job } from '../types'

export type { Job }

/** Per-project configuration read from `.claude/kokpit.json`. */
export type ProjectConfig = {
  /** Test command; arguments of `/tests` are appended (or substituted for `{args}`). */
  tests?: string
  /** Named jobs for `/job <name> [args]` and the background tool, e.g. a benchmark or a coverage run. */
  jobs?: Record<string, string>
}

export const PROJECT_CONFIG = '.claude/kokpit.json'

export function parseProjectConfig(text: string | null): ProjectConfig {
  if (!text || !text.trim()) return {}
  const raw = JSON.parse(text) as Record<string, unknown>
  const out: ProjectConfig = {}
  if (typeof raw.tests === 'string' && raw.tests.trim()) out.tests = raw.tests.trim()
  if (raw.jobs && typeof raw.jobs === 'object' && !Array.isArray(raw.jobs)) {
    const jobs: Record<string, string> = {}
    for (const [name, cmd] of Object.entries(raw.jobs as Record<string, unknown>)) {
      if (/^[\w-]+$/.test(name) && typeof cmd === 'string' && cmd.trim()) jobs[name] = cmd.trim()
    }
    if (Object.keys(jobs).length) out.jobs = jobs
  }
  return out
}

/**
 * A configured command with arguments: `{args}` takes all of them, `{1}`…`{9}` single ones, `{rest}` the
 * ones after the first; without placeholders the arguments are appended. Arguments are shell-quoted.
 */
export function fillCommand(template: string, args: string[]): string {
  const q = args.map(shellQuote)
  if (!/\{(args|rest|\d)\}/.test(template)) return [template, ...q].join(' ')
  return template
    .replace(/\{args\}/g, q.join(' '))
    .replace(/\{rest\}/g, q.slice(1).join(' '))
    .replace(/\{(\d)\}/g, (_, n: string) => q[Number(n) - 1] ?? '')
    .trim()
}

function shellQuote(s: string): string {
  return /^[\w./:=@%+,-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"
}

export function shellArgv(command: string): string[] {
  return ['bash', '-lc', command]
}

/** Splits arguments like a shell: whitespace, with quotes keeping a group together. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

/**
 * Updates a job's progress with one output line. Test runners that print `Tests: N` (or `Testy: N`) and one
 * `PASS name` / `FAIL name` line per test get a live count; any other output just shows its last line.
 */
export function readLine(job: Job, line: string): Job {
  const t = line.trim()
  if (!t) return job
  const next: Job = { ...job, lastLine: t.slice(0, 160) }
  const total = /^(?:Tests|Testy):\s*(\d+)/.exec(t)
  if (total) next.total = Number(total[1])
  const mark = /^(PASS|FAIL)\s+(\S+)/.exec(t)
  if (mark) {
    if (mark[1] === 'PASS') next.passed = job.passed + 1
    else {
      next.failed = job.failed + 1
      next.failedNames = [...job.failedNames, mark[2] ?? '?']
    }
  }
  return next
}

/** Clock-style duration: 75 s → "1:15", 3725 s → "1:02:05". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0')
}

/** One status line for the bar. */
export function jobLine(job: Job, now: number): string {
  const time = clock((job.endedAt ?? now) - job.startedAt)
  const counts =
    job.kind === 'tests' && (job.total || job.passed || job.failed)
      ? ` · ${job.passed}${job.total ? '/' + job.total : ''} ✓` + (job.failed ? ` · ${job.failed} ✗` : '')
      : ''
  if (job.endedAt === null) return `⧗ ${job.label} · ${time}${counts}`
  const ok = job.code === 0
  const failures = !ok && job.failedNames.length ? ' — ' + job.failedNames.slice(0, 3).join(', ') : ''
  const code = !ok && job.kind !== 'tests' ? ` (exit ${job.code ?? 'signal'})` : ''
  return `${ok ? '✓' : '✗'} ${job.label} · ${time}${counts}${code}${failures}`
}

/** The last `n` non-empty output lines. */
export function tail(text: string, n: number): string {
  return text
    .split('\n')
    .filter(l => l.trim())
    .slice(-n)
    .join('\n')
}

/** The message for Claude when a job ends. */
export function resultPrompt(job: Job, output: string): string {
  const head =
    `Background job "${job.label}" ${job.code === 0 ? 'succeeded' : 'failed'} ` +
    `(exit ${job.code ?? 'signal'}, ${clock((job.endedAt ?? job.startedAt) - job.startedAt)}).`
  const tests = job.kind === 'tests' ? ` Passed ${job.passed}${job.total ? '/' + job.total : ''}.` : ''
  const failed = job.failedNames.length ? ` Failed: ${job.failedNames.join(', ')}.` : ''
  const log = job.logPath ? `\nFull log: ${job.logPath}` : ''
  // A local model's output is the answer itself: keep more of it.
  const n = job.kind === 'local' ? 400 : 40
  return `${head}${tests}${failed}${log}\n\nEnd of output:\n\`\`\`\n${tail(output, n)}\n\`\`\``
}
