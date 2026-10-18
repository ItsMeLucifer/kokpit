import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DecisionCounts, Handoff, HandoffLogEntry, Job, Task, TaskStatus, Usage } from '../types'
import { applyPrompt, nextId, parseDecisions, pending, resolveDecision, toApply } from './decyzje'
import type { Decision } from './decyzje'
import { GODOT_DEFAULT, jobLine, probierzArgv, readLine, resultPrompt, shellArgv, splitArgs, testsArgv } from './tlo'

// Kokpit — pasek nad promptem.
//   wiersz 1: kontekst · limit 5h · limit tygodniowy · postęp bieżącego zadania
//   wiersz 2: od progu tokenów — handoff (przycisk / na najbliższej przerwie / od razu),
//             po zapisie „Wyczyść i wznów”, w świeżej sesji „Wznów” z ostatniego wątku.
// Handoff dopisuje do pliku wątku .claude/handoffs/<wątek>.md (skill /handoff).

const usageAtom = atom({ plugin: 'kokpit', key: 'usage' } as const, null)
const tasksAtom = atom({ plugin: 'kokpit', key: 'tasks' } as const, [])
const handoffAtom = atom(
  { plugin: 'kokpit', key: 'handoff' } as const,
  {
    snoozedUntil: 0,
    savedPath: null,
    running: false,
    startedAt: 0,
    savedTurnId: null,
    stale: false,
    clearAfter: false,
    planMode: false,
    afterPlan: false,
    clearWhenIdle: false,
    lastTokens: 0,
  },
)
const resumableAtom = atom({ plugin: 'kokpit', key: 'resumable' } as const, null)
const jobsAtom = atom({ plugin: 'kokpit', key: 'jobs' } as const, [])
const decisionsAtom = atom({ plugin: 'kokpit', key: 'decisions' } as const, null)

const DECISIONS_PANE = 'kokpit-decyzje'
const JOBS_DIR = '.claude/kokpit/tlo'
const JOBS_KEEP = 3
const OUTPUT_CAP = 3_000_000
const PID_MARK = '__KOKPIT_PID__'
const TOOL_NAME = 'w_tle'

export const HANDOFF_DIR = '.claude/handoffs'
/** „Później” i ponowny handoff w tej samej sesji: o tyle tokenów dalej. */
export const STEP_TOKENS = 30_000
/** Nigdy później niż przy 75% okna — auto-compact silnika przychodzi koło 95%. */
const WINDOW_CAP = 0.75
const LOG_LIMIT = 300

export type Mode = 'przycisk' | 'przerwa' | 'auto'

const NUDGE =
  'Kokpit (pasek postępu): przy zadaniu na więcej niż 2–3 kroki załóż listę zadań (TaskCreate) ' +
  'i aktualizuj statusy (TaskUpdate) na bieżąco — pasek nad promptem liczy z niej procent ukończenia. ' +
  'Nowe polecenie użytkownika = nowa lista; nie dopisuj zadań do już ukończonej.'

const BACKGROUND_NOTE =
  'Kokpit (zadania w tle): komendy trwające dłużej niż ~1 minutę (pełne testy, Probierz, coverage) uruchamiaj ' +
  'narzędziem mcp__kokpit__w_tle zamiast Bash i pracuj dalej; wynik przyjdzie osobną wiadomością. ' +
  'Krótkie, pojedyncze testy odpalaj normalnie.'

function decisionsNote(file: string, next: string): string {
  return (
    `Kokpit (rejestr decyzji): gdy podejmujesz za użytkownika decyzję projektową, która czeka na jego potwierdzenie, ` +
    `albo zostawiasz mu otwarte pytanie, dopisz wpis na końcu ${file} (następny numer: ${next}) zamiast zostawiać ` +
    '„do potwierdzenia” w innych dokumentach — tam wstaw tylko odnośnik (D-NNN). Format wpisu: ' +
    '„## D-NNN · tytuł”, potem linie „- status: czeka”, „- typ: propozycja|pytanie”, „- obszar: …”, ' +
    '„- propozycja: …” (albo „- pytanie: …”), „- źródło: pliki”, „- dodano: RRRR-MM-DD”. ' +
    'Rozstrzyga użytkownik w panelu /decyzje; nie zmieniaj statusu sam.'
  )
}

const COMPACT_NOTE =
  'Kokpit: jeśli rozmowa ma plik wątku w .claude/handoffs/, wskaż jego ścieżkę w streszczeniu. ' +
  'Decyzje użytkownika, odrzucone podejścia i jego uwagi/korekty przenieś dosłownie, nie streszczaj ich.'

/** Tekst zamiast skilla /handoff w trybie planowania (zapis plików jest wtedy zablokowany). */
const PLAN_NOTE =
  'Kokpit: sesja jest w trybie planowania, więc handoff jest odłożony — ruszy sam po wyjściu z trybu planowania. ' +
  'Nie zapisuj stanu sesji nigdzie (także nie do pliku planu). Powiedz to jednym zdaniem i wróć do pracy.'

/** Statusy agenta, przy których jego wynik dopiero przyjdzie do tej sesji. */
const AGENT_BUSY = ['pending', 'running', 'waiting']

/**
 * Co w tle tej sesji jeszcze pracuje: agenty, zadania Kokpitu, komendy w tle z ostatniego Stop.
 * Ich wyniki przychodzą tylko do tej rozmowy — /clear przed nimi by je zgubił.
 */
export function busyLabels(
  agents: { status: string; description: string; type: string }[],
  jobs: { endedAt: number | null; label: string }[],
  tasks: { type: string; description: string }[],
): string[] {
  return [
    ...agents.filter(a => AGENT_BUSY.includes(a.status)).map(a => a.description || a.type),
    ...jobs.filter(j => j.endedAt === null).map(j => j.label),
    // Subagenty są już w liście agentów.
    ...tasks.filter(t => t.type !== 'subagent').map(t => t.description || t.type),
  ]
}

/** Odczyt z session.measure albo $.session.usage() w jeden kształt. */
export function toUsage(u: {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}): Usage {
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const week = u.rateLimits.find(r => r.kind === 'seven_day')
  return {
    contextPercent: u.context.percent ?? null,
    contextTokens: u.context.tokens ?? null,
    contextWindow: u.context.window,
    fiveHour: five ? five.percentUsed : null,
    fiveHourResetsAt: five?.resetsAt ?? null,
    week: week ? week.percentUsed : null,
    weekResetsAt: week?.resetsAt ?? null,
  }
}

/** Próg w tokenach: ustawiony, ale nie dalej niż 75% okna modelu. */
export function thresholdFor(setting: number, window: number): number {
  return Math.min(setting, Math.floor(window * WINDOW_CAP))
}

/** Czy pora na handoff: próg przekroczony, nie odłożony, nie świeżo po poprzednim. */
export function isDue(tokens: number | null, threshold: number, h: Handoff): boolean {
  if (tokens === null || h.running) return false
  if (tokens < threshold || tokens < h.snoozedUntil) return false
  return h.lastTokens === 0 || tokens >= h.lastTokens + STEP_TOKENS
}

/** Naturalna przerwa: nic nie jest w toku albo w tej turze coś się ukończyło. */
export function isBreak(tasks: Task[], completedThisTurn: boolean): boolean {
  return completedThisTurn || !tasks.some(t => t.status === 'in_progress')
}

/** Procent ukończenia bieżącej listy zadań (null, gdy listy nie ma). */
export function progress(tasks: Task[]): { done: number; total: number; percent: number; current: string | null } | null {
  if (tasks.length === 0) return null
  const done = tasks.filter(t => t.status === 'completed').length
  // Zadanie w toku liczy się za pół — pasek rusza się, zanim cokolwiek się skończy.
  const half = tasks.filter(t => t.status === 'in_progress').length * 0.5
  const current = tasks.find(t => t.status === 'in_progress')?.subject ?? null
  return { done, total: tasks.length, percent: Math.round(((done + half) / tasks.length) * 100), current }
}

/** Nowe zadanie: gdy poprzednia lista jest już cała ukończona, zaczyna nową. */
export function addTask(tasks: Task[], task: Task): Task[] {
  const finished = tasks.length > 0 && tasks.every(t => t.status === 'completed')
  return finished ? [task] : [...tasks, task]
}

export function setStatus(tasks: Task[], id: string, status: TaskStatus | 'deleted' | undefined, subject?: string): Task[] {
  if (status === 'deleted') return tasks.filter(t => t.id !== id)
  return tasks.map(t => (t.id === id ? { ...t, status: status ?? t.status, subject: subject ?? t.subject } : t))
}

/** Czy ścieżka to plik wątku tego projektu (bez podkatalogów i wychodzenia wyżej). */
export function isHandoffPath(path: string, cwd: string): boolean {
  const dir = cwd.replace(/\/+$/, '') + '/' + HANDOFF_DIR + '/'
  if (!path.startsWith(dir) || path.includes('..')) return false
  const name = path.slice(dir.length)
  return name.endsWith('.md') && !name.includes('/')
}

/** Plik archiwum wątku (Archiwum i starsze wpisy Dziennika) — leży obok wątku, ale wątkiem nie jest. */
export const ARCHIVE_SUFFIX = '.archiwum.md'

/** Czy nazwa (albo ścieżka) to plik wątku, a nie jego archiwum. */
export function isThreadFile(name: string): boolean {
  return name.endsWith('.md') && !name.endsWith(ARCHIVE_SUFFIX)
}

/** Nazwa wątku z jego ścieżki. */
export function threadName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** Podsumowanie dziennika handoffów dla /kokpit. */
export function stats(log: HandoffLogEntry[], nowMs: number): string {
  const day = 24 * 3600 * 1000
  const today = new Date(nowMs).toDateString()
  const todays = log.filter(l => new Date(l.at).toDateString() === today)
  const week = log.filter(l => nowMs - new Date(l.at).getTime() < 7 * day)
  const avg = week.length ? Math.round(week.reduce((s, l) => s + l.tokens, 0) / week.length / 1000) : 0
  const threads = new Set(week.map(l => l.thread)).size
  return (
    `Handoffy dziś: ${todays.length} · ostatnie 7 dni: ${week.length} w ${threads} wątkach` +
    (week.length ? ` · średnio przy ${avg}k tokenów` : '') +
    ` · automatycznych: ${week.filter(l => l.mode !== 'przycisk').length}`
  )
}

export function bar(percent: number, cells: number): string {
  const full = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '█'.repeat(full) + '░'.repeat(cells - full)
}

export function tone(percent: number | null): string | undefined {
  if (percent === null) return undefined
  if (percent >= 80) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

const DAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb']

/** „14:20” dla limitu 5h, „pt 09:00” dla tygodniowego. */
export function resetLabel(iso: string | null, withDay: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  return withDay ? DAYS[d.getDay()] + ' ' + hm : hm
}

export function k(n: number | null): string {
  if (n === null) return '—'
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

// Stan modułu (ginie przy przeładowaniu — to tylko szczegóły bieżącej tury).
let completedThisTurn = false
let currentTurnId = ''
let pendingMode: Mode = 'przycisk'
let pendingTokens = 0
/** Komendy i inne zadania w tle z ostatniego classic.Stop (silnik podaje je tylko tam). */
let lastBackground: { type: string; description: string }[] = []

async function backgroundWork($: EngineInterface): Promise<string[]> {
  let agents: { status: string; description: string; type: string }[] = []
  try {
    agents = await $.agent.list()
  } catch {
    // Bez listy agentów liczą się zadania Kokpitu i komendy w tle.
  }
  return busyLabels(agents, await read($, jobsAtom), lastBackground)
}

/** Uruchamia skill z pluginu; goła nazwa działa, gdy nic innego jej nie zajmuje. */
async function runSkill($: EngineInterface, name: string, args: string): Promise<void> {
  try {
    await $.command.run({ command: 'kokpit:' + name, args })
  } catch {
    await $.command.run({ command: name, args })
  }
}

async function startHandoff($: EngineInterface, mode: Mode): Promise<void> {
  const usage = await read($, usageAtom)
  const now = await $.clock.now()
  await update($, handoffAtom, h => ({ ...h, running: true, startedAt: now, savedPath: null }))
  pendingMode = mode
  pendingTokens = usage?.contextTokens ?? 0
  try {
    await runSkill($, 'handoff', '')
  } catch (err) {
    await update($, handoffAtom, h => ({ ...h, running: false }))
    $.ui.toast('Nie udało się uruchomić /handoff: ' + String(err))
  }
}

async function noteSaved($: EngineInterface, path: string): Promise<void> {
  const tokens = pendingTokens || (await read($, usageAtom))?.contextTokens || 0
  await update($, handoffAtom, h => ({
    ...h,
    running: false,
    savedPath: path,
    savedTurnId: currentTurnId,
    stale: false,
    lastTokens: tokens,
  }))
  const entry: HandoffLogEntry = {
    at: new Date(await $.clock.now()).toISOString(),
    tokens,
    thread: threadName(path),
    mode: pendingMode,
  }
  const log = ((await $.store.get('log')) as HandoffLogEntry[] | undefined) ?? []
  await $.store.set('log', [...log, entry].slice(-LOG_LIMIT))
  pendingMode = 'przycisk'
  pendingTokens = 0
}

/** /clear i wznowienie wątku w nowej sesji (przez $.store, bo /clear kończy tę sesję). */
async function clearAndResume($: EngineInterface, path: string): Promise<void> {
  // Praca w tle tej sesji oddałaby wynik do rozmowy, której już nie ma: czekamy na nią (turn.complete).
  const busy = await backgroundWork($)
  if (busy.length > 0) {
    await update($, handoffAtom, h => ({ ...h, clearAfter: false, clearWhenIdle: true }))
    $.ui.toast(`W tle pracuje jeszcze: ${busy.join(', ')}. Wyczyszczę po ich wynikach, najpierw dopiszę je do wątku.`)
    return
  }
  await update($, handoffAtom, h => ({ ...h, clearAfter: false, clearWhenIdle: false }))
  await $.store.set('pendingResume', path)
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch {
    $.ui.toast('Wpisz /clear — Kokpit sam uruchomi /wznow')
  }
}

/** Przycisk „Wyczyść i wznów” / ręczne /clear: nieaktualny wątek najpierw dopisz, dopiero potem czyść. */
async function refreshThenClear($: EngineInterface): Promise<void> {
  await update($, handoffAtom, h => ({ ...h, clearAfter: true }))
  await startHandoff($, 'przycisk')
}

async function findResumable($: EngineInterface): Promise<string | null> {
  if (!(await $.fs.exists(HANDOFF_DIR))) return null
  let best: { path: string; at: number } | null = null
  for (const entry of await $.fs.list(HANDOFF_DIR)) {
    if (entry.kind !== 'file' || !isThreadFile(entry.name)) continue
    const path = HANDOFF_DIR + '/' + entry.name
    const stat = await $.fs.stat(path)
    if (best === null || stat.mtimeMs > best.at) best = { path, at: stat.mtimeMs }
  }
  return best ? best.path : null
}

/** Najświeższy plik wątku zapisany od `since` (z zapasem 2 s na rozjazd zegarów), albo null. */
export function pickSaved(files: { path: string; mtimeMs: number }[], since: number): string | null {
  let best: { path: string; mtimeMs: number } | null = null
  for (const f of files) {
    if (f.mtimeMs + 2000 < since) continue
    if (best === null || f.mtimeMs > best.mtimeMs) best = f
  }
  return best ? best.path : null
}

/**
 * Koniec tury w trakcie handoffu: plik wątku zapisany od startu → gotowe; nie zapisany → zdejmij „Piszę”.
 * Nie polega na wykryciu konkretnego Write/Edit (ścieżka względna, zapis z Basha, inna powierzchnia).
 */
async function finishHandoff($: EngineInterface, aborted: boolean): Promise<void> {
  const h = await read($, handoffAtom)
  if (!h.running) return
  const files: { path: string; mtimeMs: number }[] = []
  try {
    if (await $.fs.exists(HANDOFF_DIR)) {
      for (const entry of await $.fs.list(HANDOFF_DIR)) {
        if (entry.kind !== 'file' || !isThreadFile(entry.name)) continue
        const path = HANDOFF_DIR + '/' + entry.name
        files.push({ path, mtimeMs: (await $.fs.stat(path)).mtimeMs })
      }
    }
  } catch {
    // brak katalogu albo błąd odczytu = nic nie zapisano
  }
  const saved = pickSaved(files, h.startedAt)
  if (saved) {
    await noteSaved($, saved)
    return
  }
  await update($, handoffAtom, x => ({ ...x, running: false, clearAfter: false }))
  pendingMode = 'przycisk'
  pendingTokens = 0
  const why = aborted ? 'Handoff przerwany — plik wątku bez zmian.' : 'Handoff nie zapisał pliku wątku.'
  $.ui.toast(h.clearAfter ? why + ' Nie czyszczę rozmowy.' : why)
}


// ── Rejestr decyzji ──

async function readDecisions($: EngineInterface, file: string): Promise<Decision[]> {
  try {
    if (!(await $.fs.exists(file))) return []
    return parseDecisions(await $.fs.read(file))
  } catch {
    return []
  }
}

async function refreshDecisions($: EngineInterface, file: string): Promise<void> {
  const ds = await readDecisions($, file)
  const counts: DecisionCounts | null = ds.length ? { pending: pending(ds).length, toApply: toApply(ds).length } : null
  await update($, decisionsAtom, () => counts)
}

async function decide(
  $: EngineInterface,
  file: string,
  id: string,
  status: 'przyjęta' | 'odrzucona' | 'inaczej',
  answer?: string,
): Promise<void> {
  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const text = await $.fs.read(file)
  await $.fs.write(file, resolveDecision(text, id, status, date, answer))
  await refreshDecisions($, file)
  $.ui.invalidate('ui.render')
}

// ── Zadania w tle ──

/** Wyjście zadań (do „Pokaż Claude” i logu); ginie przy przeładowaniu modułu. */
const outputs = new Map<string, string>()
const pids = new Map<string, string>()

async function setJob($: EngineInterface, id: string, fn: (j: Job) => Job): Promise<void> {
  await update($, jobsAtom, js => js.map(j => (j.id === id ? fn(j) : j)))
}

async function startJob(
  $: EngineInterface,
  kind: Job['kind'],
  label: string,
  argv: string[],
  byClaude: boolean,
): Promise<string> {
  const now = await $.clock.now()
  const id = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + kind
  const job: Job = {
    id, label, kind, byClaude, startedAt: now, endedAt: null, code: null, total: null,
    passed: 0, failed: 0, failedNames: [], lastLine: '', logPath: null, hidden: false,
  }
  await update($, jobsAtom, js => [...js.filter(j => j.endedAt === null || !j.hidden), job].slice(-JOBS_KEEP))
  // Bez await: pętla żyje dalej po powrocie z haka, aż proces się skończy.
  void runJob($, job, argv)
  return id
}

async function runJob($: EngineInterface, job: Job, argv: string[]): Promise<void> {
  // Owijka podaje PID, żeby „Stop” mógł ubić proces razem z dziećmi (Godot spod run_tests).
  const wrapped = ['bash', '-c', `echo "${PID_MARK} $$"; exec "$@"`, 'kokpit', ...argv]
  const ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  let output = ''
  let partial = ''
  let current = job
  let code: number | null = null
  try {
    const stream = $.process.spawn({ argv: wrapped })
    for await (const chunk of stream) {
      const lines = (partial + chunk.text).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith(PID_MARK)) {
          pids.set(job.id, line.slice(PID_MARK.length).trim())
          continue
        }
        output += line + '\n'
        current = readLine(current, line)
      }
      if (output.length > OUTPUT_CAP) output = output.slice(-OUTPUT_CAP)
      outputs.set(job.id, output)
      const snapshot = current
      await setJob($, job.id, () => snapshot)
    }
    if (partial) {
      output += partial + '\n'
      current = readLine(current, partial)
    }
    const result = await stream.result
    code = result.code
  } catch (err) {
    output += String(err) + '\n'
    current = { ...current, lastLine: String(err).slice(0, 160) }
    code = -1
  } finally {
    ticker.cancel()
  }
  outputs.set(job.id, output)
  pids.delete(job.id)
  let logPath: string | null = null
  try {
    await $.process.run(['mkdir', '-p', JOBS_DIR])
    logPath = `${JOBS_DIR}/${job.id}.log`
    await $.fs.write(logPath, output)
  } catch {
    logPath = null
  }
  const ended: Job = { ...current, endedAt: await $.clock.now(), code, logPath }
  await setJob($, job.id, () => ended)
  if (job.byClaude) {
    await $.prompt.submit({ text: resultPrompt(ended, output) })
  } else {
    $.ui.toast(`${ended.code === 0 ? '✓' : '✗'} ${ended.label} skończone`)
  }
}

async function stopJob($: EngineInterface, id: string): Promise<void> {
  const pid = pids.get(id)
  if (!pid || !/^\d+$/.test(pid)) return
  await $.process.run(['bash', '-c', `pkill -TERM -P ${pid}; kill -TERM ${pid}`])
}

function godotPath(env: string | undefined): string {
  return env && env.trim() ? env.trim() : GODOT_DEFAULT
}

export const register: Register = (on, options) => {
  const mode: Mode =
    options?.handoffMode === 'przycisk' || options?.handoffMode === 'auto' ? options.handoffMode : 'przerwa'
  const tokensSetting =
    typeof options?.handoffTokens === 'number' && options.handoffTokens > 0 ? options.handoffTokens : 150_000
  const nudge = options?.taskNudge !== false
  const decisionsFile =
    typeof options?.decisionsFile === 'string' && options.decisionsFile.trim() ? options.decisionsFile.trim() : 'docs/decyzje.md'

  on('session.start', async ($, e, next) => {
    const usage = toUsage(await $.session.usage())
    await update($, usageAtom, () => usage)
    // Nowa sesja nie ma handoffu w toku; „Piszę” z poprzedniej (przeładowanie, /clear) to zawieszony stan.
    await update($, handoffAtom, h => (h.running ? { ...h, running: false } : h))
    await refreshDecisions($, decisionsFile)
    await $.tool.register({
      name: TOOL_NAME,
      description:
        'Uruchamia długą komendę w tle (testy, Probierz, build) i od razu wraca — pracuj dalej, wynik przyjdzie ' +
        'osobną wiadomością od Kokpitu, a postęp widać w pasku nad promptem. Użyj zamiast Bash dla wszystkiego, ' +
        'co trwa dłużej niż ~1 minutę. rodzaj: „testy” (argumenty = fragmenty nazw testów, puste = wszystkie), ' +
        '„probierz” (pierwszy argument = skrypt z tools/balance_spike bez .gd, dalej jego argumenty), ' +
        '„komenda” (argumenty = jedna komenda powłoki).',
      inputSchema: {
        type: 'object',
        properties: {
          rodzaj: { type: 'string', enum: ['testy', 'probierz', 'komenda'] },
          argumenty: { type: 'string', description: 'Argumenty jak w powłoce; dla „komenda” cała komenda.' },
          opis: { type: 'string', description: 'Krótka nazwa do paska, np. „Probierz Malbork”.' },
        },
        required: ['rodzaj'],
      },
    })
    // Komendy na końcu: rejestracja zajętej nazwy rzuca i przerwałaby resztę haka.
    await $.command.register({ name: 'kokpit', description: 'Kokpit: statystyki handoffów i ustawienia' })
    await $.command.register({ name: 'decyzje', description: 'Rejestr decyzji: panel z decyzjami do potwierdzenia', immediate: true })
    await $.command.register({ name: 'testy', description: 'Testy w tle (run_tests.py); argumenty = fragmenty nazw', argumentHint: '[wzorce]', immediate: true })
    await $.command.register({ name: 'probierz', description: 'Probierz w tle: skrypt z tools/balance_spike i jego argumenty', argumentHint: '<skrypt> [argumenty]', immediate: true })
    await $.command.register({ name: 'tlo', description: 'Dowolna komenda powłoki w tle', argumentHint: '<komenda>', immediate: true })
    try {
      if ((await $.session.turns()) === 0) {
        const found = await findResumable($)
        await update($, resumableAtom, () => found)
      }
    } catch {
      // Brak katalogu albo uprawnień — po prostu bez przycisku „Wznów”.
    }
    return next(e)
  })

  // Po /clear: $.state wraca do zera, a jeśli kliknięto „Wyczyść i wznów”, od razu /wznow.
  on('classic.SessionStart', { source: ['clear'] }, async ($, e, next) => {
    const pending = (await $.store.get('pendingResume')) as string | undefined
    if (pending) {
      await $.store.delete('pendingResume')
      $.clock.after(0, () => runSkill($, 'wznow', threadName(pending)))
    } else {
      const found = await findResumable($)
      await update($, resumableAtom, () => found)
    }
    return next(e)
  })

  on('command.run', { command: 'kokpit' }, async $ => {
    const usage = await read($, usageAtom)
    const log = ((await $.store.get('log')) as HandoffLogEntry[] | undefined) ?? []
    const threshold = thresholdFor(tokensSetting, usage?.contextWindow ?? 200_000)
    return {
      text: stats(log, await $.clock.now()) + `\nTryb: ${mode} · próg: ${k(threshold)} tokenów · zmiana: /config → Kokpit`,
    }
  })

  // ── Rejestr decyzji ──
  on('command.run', { command: 'decyzje' }, async $ => {
    await refreshDecisions($, decisionsFile)
    if (!(await $.fs.exists(decisionsFile))) {
      return { text: `Nie ma pliku ${decisionsFile}. Poproś Claude, żeby założył rejestr (format jest w README Kokpitu).` }
    }
    await $.ui.open({ id: DECISIONS_PANE, title: 'Decyzje', focus: true, closeOnEscape: true })
    return {}
  })

  // ── Zadania w tle ──
  on('command.run', { command: 'testy' }, async ($, e) => {
    const patterns = splitArgs(e.args)
    await startJob($, 'testy', patterns.length ? 'testy ' + patterns.join(' ') : 'testy (wszystkie)', testsArgv(patterns), false)
    return { text: 'Testy ruszyły w tle — postęp w pasku nad promptem.' }
  })

  on('command.run', { command: 'probierz' }, async ($, e) => {
    const args = splitArgs(e.args)
    try {
      const argv = probierzArgv(godotPath(await $.env.get('GODOT')), args)
      await startJob($, 'probierz', 'Probierz ' + args.join(' '), argv, false)
      return { text: 'Probierz ruszył w tle — postęp w pasku nad promptem.' }
    } catch (err) {
      return { text: String(err instanceof Error ? err.message : err) }
    }
  })

  on('command.run', { command: 'tlo' }, async ($, e) => {
    if (!e.args.trim()) return { text: 'Podaj komendę, np. `/tlo python3 tools/testing/coverage.py`.' }
    await startJob($, 'komenda', e.args.trim().slice(0, 40), shellArgv(e.args), false)
    return { text: 'Komenda ruszyła w tle — postęp w pasku nad promptem.' }
  })

  // Narzędzie dla Claude: wraca od razu, wynik przychodzi wiadomością po zakończeniu.
  on('tool.call', { tool: 'mcp__kokpit__w_tle' }, async ($, e) => {
    const input = e as unknown as { rodzaj?: string; argumenty?: string; opis?: string }
    const rodzaj = input.rodzaj === 'probierz' || input.rodzaj === 'komenda' ? input.rodzaj : 'testy'
    const args = input.argumenty ?? ''
    try {
      let argv: string[]
      if (rodzaj === 'testy') argv = testsArgv(splitArgs(args))
      else if (rodzaj === 'probierz') argv = probierzArgv(godotPath(await $.env.get('GODOT')), splitArgs(args))
      else {
        if (!args.trim()) return { result: 'Brak komendy w argumentach.' }
        argv = shellArgv(args)
      }
      const label = (input.opis ?? '').trim() || `${rodzaj} ${args}`.trim().slice(0, 40)
      const id = await startJob($, rodzaj, label, argv, true)
      return {
        result: `Uruchomione w tle (${id}). Pracuj dalej; wynik przyjdzie osobną wiadomością od Kokpitu po zakończeniu.`,
      }
    } catch (err) {
      return { result: 'Nie uruchomiono: ' + String(err instanceof Error ? err.message : err) }
    }
  })

  on('session.measure', async ($, e, next) => {
    await update($, usageAtom, () => toUsage(e))
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const ds = await readDecisions($, decisionsFile)
    const extra = [
      ...(nudge ? [{ id: 'kokpit-tasks', text: NUDGE, scope: 'session' as const }] : []),
      { id: 'kokpit-background', text: BACKGROUND_NOTE, scope: 'session' as const },
      { id: 'kokpit-decisions', text: decisionsNote(decisionsFile, nextId(ds)), scope: 'session' as const },
    ]
    return { ...r, sections: [...r.sections, ...extra] }
  })

  // Siatka bezpieczeństwa: gdy jednak dojdzie do auto-compactu, streszczenie ma nie rozmywać
  // decyzji i ma wskazać plik wątku. Nie blokujemy go — przy pełnym oknie handoff mógłby się
  // już nie zmieścić.
  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    return next({ ...e, instructions: [e.instructions, COMPACT_NOTE].filter(Boolean).join('\n') })
  }).catch(($, e, next) => next(e))

  // Pierwszy prompt sesji chowa „Wznów” — użytkownik już zdecydował, od czego zaczyna.
  // Ręczne /clear po nieaktualnym handoffie zgubiłoby to, co było po zapisie: najpierw dopisz.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    if (e.origin.kind === 'plugin') return next(e)
    const h = await read($, handoffAtom)
    if (!h.savedPath || !h.stale || h.running) return next(e)
    $.clock.after(0, () => refreshThenClear($))
    return {
      text:
        'Kokpit: rozmowa poszła dalej od zapisu wątku „' +
        threadName(h.savedPath) +
        '” — najpierw dopisuję handoff, potem sam wyczyszczę. Żeby wyczyścić bez zapisu: „Zostań tutaj”, potem /clear.',
    }
  }).catch(($, e, next) => next(e))

  // /handoff wpisany ręcznie albo wywołany przez Claude też liczy się jako „piszę”.
  // W trybie planowania zapis wątku jest zablokowany: zamiast skilla notka, a handoff wraca po wyjściu.
  on('skill.prompt', async ($, e, next) => {
    if (e.skill === 'kokpit:handoff' || e.skill === 'handoff') {
      const h = await read($, handoffAtom)
      if (h.planMode) {
        await update($, handoffAtom, x => ({ ...x, running: false, afterPlan: true }))
        return { text: PLAN_NOTE }
      }
      if (!h.running) {
        const now = await $.clock.now()
        pendingTokens = (await read($, usageAtom))?.contextTokens ?? 0
        await update($, handoffAtom, x => ({ ...x, running: true, startedAt: now, savedPath: null }))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await update($, resumableAtom, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Tryb planowania głównej pętli: przypomnienie idzie z każdym zapytaniem, wyjście raz.
  on('prompt.attachment', { type: ['plan_mode', 'plan_mode_reentry', 'plan_mode_exit'] }, async ($, e, next) => {
    if (!e.agentId) {
      const planMode = e.type !== 'plan_mode_exit'
      if ((await read($, handoffAtom)).planMode !== planMode) await update($, handoffAtom, h => ({ ...h, planMode }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Komendy i inne zadania w tle silnik podaje tylko przy Stop — zapamiętaj je do decyzji o /clear.
  on('classic.Stop', async ($, e, next) => {
    lastBackground = (e.background_tasks ?? []).map(t => ({ type: t.type, description: t.description }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    completedThisTurn = false
    currentTurnId = e.turnId
    return next(e)
  })

  // Koniec tury: tu zapada decyzja o automatycznym handoffie.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    // Tura, w której pisał się handoff, zamyka go zawsze — także przerwana albo bez zapisu.
    const wasRunning = (await read($, handoffAtom)).running
    if (wasRunning) await finishHandoff($, e.isAborted)
    const h = await read($, handoffAtom)
    if (h.savedPath && e.turnId === h.savedTurnId) {
      // Ta tura zapisała wątek. Odświeżenie przed /clear udane → czyść i wznawiaj, poza bieżącym zdarzeniem.
      if (h.clearAfter) {
        const path = h.savedPath
        $.clock.after(0, () => clearAndResume($, path))
      }
      return r
    }
    if (wasRunning) return r
    if (h.savedPath && !h.stale) await update($, handoffAtom, x => ({ ...x, stale: true }))
    // W trybie planowania nic nie piszemy; handoff i /clear czekają.
    if (h.planMode) return r
    // „Wyczyść i wznów” czekało na pracę w tle: gdy skończona, jej wyniki są już w rozmowie — dopisz i czyść.
    if (h.clearWhenIdle) {
      if (h.savedPath && (await backgroundWork($)).length === 0) {
        await update($, handoffAtom, x => ({ ...x, clearWhenIdle: false }))
        $.clock.after(0, () => refreshThenClear($))
      }
      return r
    }
    if (e.isAborted) return r
    // Handoff poproszony w trybie planowania rusza na końcu pierwszej tury po wyjściu z niego.
    if (h.afterPlan) {
      await update($, handoffAtom, x => ({ ...x, afterPlan: false }))
      $.clock.after(0, () => startHandoff($, 'przycisk'))
      return r
    }
    if (mode === 'przycisk') return r
    const usage = await read($, usageAtom)
    if (!usage || !isDue(usage.contextTokens, thresholdFor(tokensSetting, usage.contextWindow), await read($, handoffAtom))) {
      return r
    }
    if (mode === 'przerwa' && !isBreak(await read($, tasksAtom), completedThisTurn)) return r
    // Poza bieżącym zdarzeniem: tura musi się najpierw zamknąć.
    $.clock.after(0, () => startHandoff($, mode))
    return r
  })

  // ── Lista zadań: TaskCreate / TaskUpdate (nowe narzędzia) i TodoWrite (starsze) ──
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.isError && r.result && 'task' in r.result) {
      const task: Task = { id: String(r.result.task.id), subject: r.result.task.subject, status: 'pending' }
      await update($, tasksAtom, ts => addTask(ts, task))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.isError && e.tool === 'TaskUpdate') {
      if (e.status === 'completed') completedThisTurn = true
      await update($, tasksAtom, ts => setStatus(ts, String(e.taskId), e.status, e.subject))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.isError && e.tool === 'TodoWrite') {
      const before = (await read($, tasksAtom)).filter(t => t.status === 'completed').length
      const tasks: Task[] = e.todos.map((t, i) => ({ id: 'todo-' + i, subject: t.content, status: t.status }))
      if (tasks.filter(t => t.status === 'completed').length > before) completedThisTurn = true
      await update($, tasksAtom, () => tasks)
    }
    return r
  }).catch(($, e, next) => next(e))

  // Zapis wątku nie pyta o zgodę: tylko plik .md wprost w <projekt>/.claude/handoffs/.
  on('tool.check', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const path = (e.input as { file_path?: unknown } | null)?.file_path
    if (typeof path === 'string' && isHandoffPath(path, await $.session.cwd())) return { decision: 'allow' }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── Zapis pliku wątku w trakcie handoffu = handoff gotowy ──
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const r = await next(e)
    if (r.isError || (e.tool !== 'Write' && e.tool !== 'Edit')) return r
    const path = e.file_path.startsWith('/') ? e.file_path : (await $.session.cwd()).replace(/\/+$/, '') + '/' + e.file_path
    if (path.endsWith('/' + decisionsFile) || path === decisionsFile) await refreshDecisions($, decisionsFile)
    if (path.includes('/' + HANDOFF_DIR + '/') && !path.includes('/.poprzednie/') && isThreadFile(path)) {
      // Edycje wątku poza handoffem (np. ręczna poprawka) nie udają zakończonego handoffu.
      if ((await read($, handoffAtom)).running) await noteSaved($, path)
    }
    return r
  }).catch(($, e, next) => next(e))

  // ── Panel decyzji ──
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== DECISIONS_PANE) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Pole tekstowe jest w terminalu i aplikacji desktopowej; gdzie indziej zostają przyciski.
    const Input = 'Input' in els ? els.Input : null
    const ds = await readDecisions($, decisionsFile)
    const open = pending(ds)
    const ready = toApply(ds)

    const rows = open.map(d => {
      const isQuestion = (d.fields['typ'] ?? '').toLowerCase().startsWith('pyt')
      const body = d.fields['propozycja'] ?? d.fields['pytanie'] ?? ''
      const meta = [d.fields['obszar'], d.fields['źródło']].filter(Boolean).join(' · ')
      return (
        <Box key={'d-' + d.id} flexDirection="column" marginBottom={1}>
          <Text bold>{`${d.id} · ${d.title}` + (isQuestion ? '  (pytanie)' : '')}</Text>
          {body ? <Text wrap="wrap">{body}</Text> : ''}
          {meta ? <Text dimColor wrap="truncate-end">{meta}</Text> : ''}
          <Box flexDirection="row" columnGap={2}>
            {isQuestion ? (
              ''
            ) : (
              <Button key={'ok-' + d.id} label="Przyjmij" onPress={() => decide($, decisionsFile, d.id, 'przyjęta')} />
            )}
            {isQuestion ? (
              ''
            ) : (
              <Button key={'no-' + d.id} label="Odrzuć" onPress={() => decide($, decisionsFile, d.id, 'odrzucona')} />
            )}
            {Input ? (
            <Input
              key={'in-' + d.id}
              label={isQuestion ? 'Odpowiedź' : 'Inaczej'}
              placeholder={isQuestion ? 'wpisz odpowiedź i Enter' : 'własna wersja i Enter'}
              value=""
              submitLabel="zapisz"
              onSubmit={async (value: string) => {
                if (!value.trim()) return
                await decide($, decisionsFile, d.id, isQuestion ? 'przyjęta' : 'inaczej', value)
              }}
            />
            ) : (
              ''
            )}
          </Box>
        </Box>
      )
    })

    const footer = ready.length ? (
      <Box flexDirection="row" columnGap={2}>
        <Text>{`Rozstrzygnięte, do przeniesienia do dokumentów: ${ready.length}`}</Text>
        <Button
          key="kokpit-apply"
          label="Wprowadź do dokumentów"
          onPress={async () => {
            await $.ui.close({ id: DECISIONS_PANE })
            await $.prompt.submit({ text: applyPrompt(decisionsFile, ready), asUser: true })
          }}
        />
      </Box>
    ) : (
      ''
    )

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {open.length
            ? `${open.length} czeka · ${decisionsFile} · Tab przechodzi między przyciskami, Esc zamyka`
            : `Nic nie czeka na decyzję · ${decisionsFile}`}
        </Text>
        <Text> </Text>
        {rows}
        {footer}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const usage = await read($, usageAtom)
    const tasks = await read($, tasksAtom)
    const handoff = await read($, handoffAtom)
    const resumable = await read($, resumableAtom)
    const jobs = (await read($, jobsAtom)).filter(j => !j.hidden)
    const decisions = await read($, decisionsAtom)
    if (usage === null) return next(e)
    const now = await $.clock.now()

    const { Box, Text, Button } = $.ui.resolve(e)
    const narrow = e.props.bodyColumns < 100
    const cells = narrow ? 6 : 10
    const ctx = usage.contextPercent
    const tokens = usage.contextTokens
    const threshold = thresholdFor(tokensSetting, usage.contextWindow)
    const p = progress(tasks)

    const sep = <Text dimColor>{'  ·  '}</Text>
    const meter = (label: string, value: number | null, extra: string) => (
      <Text>
        <Text dimColor>{label + ' '}</Text>
        {value === null ? (
          <Text dimColor>—</Text>
        ) : (
          <Text color={tone(value)}>{`${bar(value, cells)} ${Math.round(value)}%`}</Text>
        )}
        {extra ? <Text dimColor>{' ' + extra}</Text> : ''}
      </Text>
    )

    const ctxExtra = narrow || tokens === null ? '' : `${k(tokens)}/${k(usage.contextWindow)}`
    const fiveReset = resetLabel(usage.fiveHourResetsAt, false)
    const weekReset = resetLabel(usage.weekResetsAt, true)

    const taskText = p ? (
      <Text>
        <Text dimColor>{(narrow ? 'Zad.' : 'Zadanie') + ' '}</Text>
        <Text color={p.percent === 100 ? 'green' : undefined}>{`${bar(p.percent, cells)} ${p.percent}%`}</Text>
        <Text dimColor>{` ${p.done}/${p.total}` + (p.current && !narrow ? ' — ' + p.current : '')}</Text>
      </Text>
    ) : (
      <Text dimColor>{narrow ? 'Zad. —' : 'Zadanie — brak listy'}</Text>
    )

    const meters = (
      <Box flexDirection="row" flexWrap="wrap">
        {meter(narrow ? 'Ktx' : 'Kontekst', ctx, ctxExtra)}
        {sep}
        {meter('5h', usage.fiveHour, fiveReset && '→' + fiveReset)}
        {sep}
        {meter(narrow ? 'Tydz.' : 'Tydzień', usage.week, weekReset && '→' + weekReset)}
        {sep}
        {taskText}
        {decisions && (decisions.pending || decisions.toApply) ? sep : ''}
        {decisions && (decisions.pending || decisions.toApply) ? (
          <Button
            key="kokpit-decisions"
            label={
              `Decyzje: ${decisions.pending} czeka` + (decisions.toApply ? ` · ${decisions.toApply} do wprowadzenia` : '')
            }
            hotkey="9"
            plain
            onPress={async () => {
              await $.ui.open({ id: DECISIONS_PANE, title: 'Decyzje', focus: true, closeOnEscape: true })
            }}
          />
        ) : (
          ''
        )}
      </Box>
    )

    const jobRows = jobs.map(j => (
      <Box key={'job-' + j.id} flexDirection="row" columnGap={2}>
        <Text color={j.endedAt === null ? 'yellow' : j.code === 0 ? 'green' : 'red'}>{jobLine(j, now)}</Text>
        {j.endedAt === null ? (
          <Button key={'stop-' + j.id} label="Stop" plain onPress={() => stopJob($, j.id)} />
        ) : (
          ''
        )}
        {j.endedAt !== null && !j.byClaude ? (
          <Button
            key={'show-' + j.id}
            label="Pokaż Claude"
            plain
            onPress={async () => {
              await setJob($, j.id, x => ({ ...x, hidden: true }))
              await $.prompt.submit({ text: resultPrompt(j, outputs.get(j.id) ?? j.lastLine), asUser: true })
            }}
          />
        ) : (
          ''
        )}
        {j.endedAt !== null ? (
          <Button key={'hide-' + j.id} label="Ukryj" plain onPress={() => setJob($, j.id, x => ({ ...x, hidden: true }))} />
        ) : (
          ''
        )}
      </Box>
    ))

    let action = null
    if (handoff.savedPath) {
      const path = handoff.savedPath
      action = (
        <Box flexDirection="row" columnGap={2}>
          {handoff.clearWhenIdle ? (
            <Text color="yellow">{`⏳ Wątek „${threadName(path)}” zapisany — wyczyszczę po wynikach pracy w tle`}</Text>
          ) : handoff.stale ? (
            <Text color="yellow">{`⚠ Wątek „${threadName(path)}” zapisany wcześniej — rozmowa poszła dalej`}</Text>
          ) : (
            <Text color="green">{`✓ Wątek „${threadName(path)}” zapisany`}</Text>
          )}
          <Button
            key="kokpit-clear-resume"
            label={handoff.stale ? 'Dopisz, wyczyść i wznów' : 'Wyczyść i wznów'}
            hotkey="1"
            onPress={() => (handoff.stale ? refreshThenClear($) : clearAndResume($, path))}
          />
          <Button
            key="kokpit-stay"
            label="Zostań tutaj"
            plain
            onPress={() => update($, handoffAtom, h => ({ ...h, savedPath: null, clearWhenIdle: false }))}
          />
        </Box>
      )
    } else if (handoff.running) {
      action = <Text color="yellow">{`… Piszę handoff do ${HANDOFF_DIR}/`}</Text>
    } else if (handoff.planMode && (handoff.afterPlan || isDue(tokens, threshold, handoff))) {
      action = <Text color={tone(ctx)}>{`⏸ Kontekst ${k(tokens)} — handoff po wyjściu z trybu planowania.`}</Text>
    } else if (isDue(tokens, threshold, handoff)) {
      const why =
        mode === 'przycisk'
          ? `⚑ Kontekst ${k(tokens)} — dobry moment na handoff.`
          : `⚑ Kontekst ${k(tokens)} — handoff ${mode === 'auto' ? 'po tej turze' : 'przy najbliższej przerwie'}.`
      action = (
        <Box flexDirection="row" columnGap={2}>
          <Text color={tone(ctx)}>{why}</Text>
          <Button
            key="kokpit-handoff"
            label={mode === 'przycisk' ? 'Handoff' : 'Teraz'}
            hotkey="1"
            onPress={() => startHandoff($, 'przycisk')}
          />
          <Button
            key="kokpit-snooze"
            label="Później"
            hotkey="2"
            onPress={() => update($, handoffAtom, h => ({ ...h, snoozedUntil: (tokens ?? 0) + STEP_TOKENS }))}
          />
        </Box>
      )
    } else if (resumable && !e.props.isWorking) {
      const path = resumable
      action = (
        <Box flexDirection="row" columnGap={2}>
          <Text dimColor>{`Ostatni wątek: „${threadName(path)}”`}</Text>
          <Button
            key="kokpit-resume"
            label="Wznów"
            hotkey="1"
            onPress={async () => {
              await update($, resumableAtom, () => null)
              await runSkill($, 'wznow', threadName(path))
            }}
          />
          <Button key="kokpit-resume-no" label="Nie" plain onPress={() => update($, resumableAtom, () => null)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {meters}
        {jobRows}
        {action}
      </Box>
    )
  })
}
