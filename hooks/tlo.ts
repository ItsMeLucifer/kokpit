// Zadania w tle: testy (tools/testing/run_tests.py), Probierz (skrypty tools/balance_spike)
// i dowolna komenda. Same funkcje czyste: budowanie wywołań i czytanie postępu z wyjścia.

import type { Job } from '../types'

export type { Job }

export const GODOT_DEFAULT = '/Applications/Godot.app/Contents/MacOS/Godot'

export function testsArgv(patterns: string[]): string[] {
  return ['python3', 'tools/testing/run_tests.py', ...patterns]
}

/** `/probierz analyze level_2 sword 4` → Godot headless ze skryptem Probierza i argumentami. */
export function probierzArgv(godot: string, args: string[]): string[] {
  const [script, ...rest] = args
  if (!script) throw new Error('Podaj skrypt Probierza, np. `/probierz full_level malbork sword 150000 0`.')
  const name = script.replace(/\.gd$/, '')
  if (!/^[\w-]+$/.test(name)) throw new Error(`Niepoprawna nazwa skryptu: ${script}`)
  return [godot, '--headless', '--path', '.', '--script', `res://tools/balance_spike/${name}.gd`, '--', ...rest]
}

export function shellArgv(command: string): string[] {
  return ['bash', '-lc', command]
}

/** Dzieli argumenty jak powłoka: spacje, z „cudzysłowami” trzymającymi całość. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

/** Aktualizuje postęp zadania o jedną linię wyjścia (format run_tests.py). */
export function readLine(job: Job, line: string): Job {
  const t = line.trim()
  if (!t) return job
  const next: Job = { ...job, lastLine: t.slice(0, 160) }
  const total = /^Testy:\s*(\d+)/.exec(t)
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

/** Czas jak na zegarze: 75 s → „1:15”, 3725 s → „1:02:05”. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0')
}

/** Jedna linia stanu zadania do paska. */
export function jobLine(job: Job, now: number): string {
  const time = clock((job.endedAt ?? now) - job.startedAt)
  const counts =
    job.kind === 'testy' && (job.total || job.passed || job.failed)
      ? ` · ${job.passed}${job.total ? '/' + job.total : ''} ✓` + (job.failed ? ` · ${job.failed} ✗` : '')
      : ''
  if (job.endedAt === null) return `⧗ ${job.label} · ${time}${counts}`
  const ok = job.code === 0
  const tail = !ok && job.failedNames.length ? ' — ' + job.failedNames.slice(0, 3).join(', ') : ''
  const code = !ok && job.kind !== 'testy' ? ` (kod ${job.code ?? 'sygnał'})` : ''
  return `${ok ? '✓' : '✗'} ${job.label} · ${time}${counts}${code}${tail}`
}

/** Ostatnie `n` niepustych linii wyjścia. */
export function tail(text: string, n: number): string {
  return text
    .split('\n')
    .filter(l => l.trim())
    .slice(-n)
    .join('\n')
}

/** Wiadomość dla Claude po zakończeniu zadania. */
export function resultPrompt(job: Job, output: string): string {
  const head =
    `Zadanie w tle „${job.label}” skończyło się ${job.code === 0 ? 'powodzeniem' : 'błędem'} ` +
    `(kod ${job.code ?? 'sygnał'}, ${clock((job.endedAt ?? job.startedAt) - job.startedAt)}).`
  const tests = job.kind === 'testy' ? ` Zaliczone ${job.passed}${job.total ? '/' + job.total : ''}.` : ''
  const failed = job.failedNames.length ? ` Nie zaliczone: ${job.failedNames.join(', ')}.` : ''
  const log = job.logPath ? `\nPełny log: ${job.logPath}` : ''
  return `${head}${tests}${failed}${log}\n\nKońcówka wyjścia:\n\`\`\`\n${tail(output, 40)}\n\`\`\``
}
