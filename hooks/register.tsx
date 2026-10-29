import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Answer,
  DecisionCounts,
  EconomyState,
  Handoff,
  HandoffLogEntry,
  InboxItem,
  Job,
  Tab,
  Task,
  TaskStatus,
  ToolsInfo,
  Usage,
} from '../types'
import {
  PROJECT_CONFIG,
  fillCommand,
  jobLine,
  parseProjectConfig,
  readLine,
  resultPrompt,
  shellArgv,
  splitArgs,
} from './background'
import type { ProjectConfig } from './background'
import { applyPrompt, entryFormat, isQuestion, nextId, parseDecisions, pending, resolveDecision, toApply } from './decisions'
import type { Decision, Language } from './decisions'
import {
  ECONOMY_OFF,
  EFFORT_FACTOR,
  EFFORT_NOTE,
  HAIKU_AGENTS,
  HAIKU_TYPES,
  LOCAL_DIR,
  LOCAL_TOOL,
  PLAN_NAME,
  RATINGS,
  RATING_TOOL,
  SPLIT_NOTE,
  calibrationAddCost,
  calibrationReading,
  compact,
  effortCacheSafe,
  emptyStats,
  isLevel,
  isRating,
  knownModel,
  levelFor,
  localCodeCmd,
  localNote,
  localTextCmd,
  mergeStats,
  parseCalibration,
  parseOllamaList,
  parseSettings,
  parseStats,
  pct,
  priceFor,
  range,
  rank,
  savedOutput,
  splitNoteStandard,
  statsView,
  stepCost,
  subagentEffort,
  subagentModel,
  subagentStepLevel,
  usd,
} from './economy'
import type { Calibration, EconomySettings, EconomyStats, Level, Plan, StepUsage } from './economy'
import { hiddenSkills, parseShare, withSkill } from './tools'

// Kokpit: a band above the prompt.
//   row 1: context · 5-hour limit · weekly limit · progress of the current task list
//   row 2: from a token threshold on, a handoff (button / after a finished task / right away);
//          after the save "Clear and resume" (or on its own with the next message);
//          in a fresh session "Resume" for the latest thread.
// A handoff appends to the thread file .claude/handoffs/<thread>.md (the /handoff skill).

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
    awaiting: false,
  },
)
const resumableAtom = atom({ plugin: 'kokpit', key: 'resumable' } as const, null)
const jobsAtom = atom({ plugin: 'kokpit', key: 'jobs' } as const, [])
const decisionsAtom = atom({ plugin: 'kokpit', key: 'decisions' } as const, null)
const answersAtom = atom({ plugin: 'kokpit', key: 'answers' } as const, [])
const previousAtom = atom({ plugin: 'kokpit', key: 'previous' } as const, null)
const toolsAtom = atom({ plugin: 'kokpit', key: 'tools' } as const, null)
const ownerAtom = atom({ plugin: 'kokpit', key: 'owner' } as const, null)
const inboxAtom = atom({ plugin: 'kokpit', key: 'inbox' } as const, [] as InboxItem[])
const ECONOMY_0: EconomyState = {
  active: ECONOMY_OFF,
  saved: ECONOMY_OFF,
  rating: null,
  reason: '',
  bumps: 0,
  ceiling: null,
  current: null,
}
const economyAtom = atom({ plugin: 'kokpit', key: 'economy' } as const, ECONOMY_0)
const economyStatsAtom = atom({ plugin: 'kokpit', key: 'economyStats' } as const, null as EconomyStats | null)
const localAtom = atom(
  { plugin: 'kokpit', key: 'local' } as const,
  null as { models: string[]; opencode: boolean; ollama: boolean } | null,
)
const tabAtom = atom({ plugin: 'kokpit', key: 'tab' } as const, 'economy' as Tab)
const calibrationAtom = atom(
  { plugin: 'kokpit', key: 'calibration' } as const,
  null as { calibration: Calibration; plan: Plan } | null,
)

const DECISIONS_PANE = 'kokpit-decisions'
const PREVIOUS_PANE = 'kokpit-previous'
const TOOLS_PANE = 'kokpit-tools'
const KOKPIT_PANE = 'kokpit-panel'
const TABS: { id: Tab; label: string }[] = [
  { id: 'economy', label: 'Economy' },
  { id: 'stats', label: 'Stats' },
  { id: 'handoff', label: 'Handoff & tools' },
]
/** Latest answers of a conversation Kokpit cleared (`<thread>.md`). */
export const ANSWERS_DIR = '.claude/kokpit/previous'
/** How many of Claude's latest answers survive a clear. */
export const ANSWERS_KEEP = 2
const JOBS_DIR = '.claude/kokpit/jobs'
const JOBS_KEEP = 3
const OUTPUT_CAP = 3_000_000
const PID_MARK = '__KOKPIT_PID__'
const BACKGROUND_TOOL = 'background'

export const HANDOFF_DIR = '.claude/handoffs'
/** "Later" and a repeated handoff in the same session: this many tokens further. */
export const STEP_TOKENS = 30_000
/** How long "resume after /clear" lives in the store; older entries are leftovers of a failed clear. */
export const PENDING_TTL_MS = 5 * 60_000
/** Leftovers of the /clear bridge from closed windows are cleaned after this long (a handoff never takes it). */
const FLOW_ORPHAN_MS = 60 * 60_000
/** Keys of the bridge across /clear; in the store always with the window id (`pendingPrompt:<id>`). */
const FLOW_KEYS = ['pendingPrompt', 'pendingResume', 'pendingPrevious', 'pendingAt'] as const
type FlowKey = (typeof FLOW_KEYS)[number]
/** Keys of old code (shared by all windows), removed at start. */
const LEGACY_KEYS = ['pendingContext', 'pendingPrompt', 'pendingResume', 'pendingPrevious']

/**
 * A Kokpit file in the project: from the session root, not the current directory, because `cd` in Bash moves
 * the latter (after `cd .claude/handoffs` a relative `.claude/kokpit/…` would land in the wrong place).
 */
async function inProject($: EngineInterface, rel: string): Promise<string> {
  if (rel.startsWith('/')) return rel
  return (await $.session.root()).replace(/\/+$/, '') + '/' + rel
}

let owner: string | null = null

/**
 * Store key of this conversation window. The store is shared by all sessions and projects, and a message held
 * before /clear must come back to the same conversation, not a parallel one. Window id = id of the process's
 * first session; it lives in the module (survives /clear, same process) and in $.state (survives a code reload).
 */
async function flowKey($: EngineInterface, name: FlowKey): Promise<string> {
  const kept = await read($, ownerAtom)
  if (!owner) owner = kept ?? (await $.session.id().catch(() => Math.random().toString(36).slice(2, 10)))
  if (kept !== owner) await update($, ownerAtom, () => owner)
  return `${name}:${owner}`
}

async function flowGet($: EngineInterface, name: FlowKey): Promise<unknown> {
  return $.store.get(await flowKey($, name))
}

async function flowSet($: EngineInterface, name: FlowKey, value: unknown): Promise<void> {
  await $.store.set(await flowKey($, name), value)
  if (name !== 'pendingAt') await $.store.set(await flowKey($, 'pendingAt'), await $.clock.now())
}

async function flowDelete($: EngineInterface, name: FlowKey): Promise<void> {
  await $.store.delete(await flowKey($, name))
}

/** "Resume after /clear" is fresh: saved a moment ago, not left behind by a long-failed clear. */
export function isFresh(at: unknown, now: number): boolean {
  return typeof at === 'number' && now - at <= PENDING_TTL_MS
}

/**
 * Store keys to delete: old shared ones (from before window keys) and bridges of windows silent for an hour
 * (closed in the middle of clearing).
 */
export function orphanKeys(keys: string[], store: Record<string, unknown>, now: number): string[] {
  const flowOwner = (k: string): string | null => {
    const [name = '', id = ''] = k.split(':')
    return id && (FLOW_KEYS as readonly string[]).includes(name) ? id : null
  }
  const stale = new Set<string>()
  for (const k of keys) {
    const id = flowOwner(k)
    const at = id ? store[`pendingAt:${id}`] : undefined
    if (id && (typeof at !== 'number' || now - at > FLOW_ORPHAN_MS)) stale.add(id)
  }
  return keys.filter(k => LEGACY_KEYS.includes(k) || stale.has(flowOwner(k) ?? ''))
}
/** Never later than at 75% of the window: the engine's auto-compact comes around 95%. */
const WINDOW_CAP = 0.75
/** Default hard threshold: soft + this. From it on a handoff starts even mid-work. */
export const HARD_EXTRA = 100_000
/** The hard threshold is never further than 85% of the window. */
const HARD_CAP = 0.85
const LOG_LIMIT = 300

export type Mode = 'button' | 'break' | 'auto'
/** Log entry mode: the handoff mode, or a refresh of the thread before clearing on a message. */
export type LogMode = HandoffLogEntry['mode']
/** After a thread is saved: clear on the user's next message, or only from the button. */
export type ClearMode = 'message' | 'button'

/** Option values accepted from before 0.10 (Polish). */
export function parseMode(v: unknown): Mode {
  if (v === 'button' || v === 'przycisk') return 'button'
  if (v === 'auto') return 'auto'
  return 'break'
}

export function parseClearMode(v: unknown): ClearMode {
  return v === 'button' || v === 'przycisk' ? 'button' : 'message'
}

export function parseLanguage(v: unknown): Language {
  return v === 'pl' ? 'pl' : 'en'
}

/** Log entries written before 0.10 use Polish mode names. */
export function logMode(m: unknown): LogMode {
  if (m === 'przycisk' || m === 'button') return 'button'
  if (m === 'dopisanie' || m === 'refresh') return 'refresh'
  if (m === 'auto') return 'auto'
  return 'break'
}

const NUDGE =
  'Kokpit (progress bar): for a task of more than 2–3 steps, create a task list (TaskCreate) and keep the ' +
  'statuses current (TaskUpdate): the band above the prompt computes the completion percentage from it. A new ' +
  'user request = a new list; do not add tasks to a list that is already complete.'

const BACKGROUND_NOTE =
  'Kokpit (background jobs): run commands that take longer than ~1 minute (full test suites, benchmarks, ' +
  'coverage) with the mcp__kokpit__background tool instead of Bash and keep working; the result arrives as a ' +
  'separate message. Run short single tests normally.'

/** Files that mark a repo following the Kokpit repo standard (English and Polish core). */
const STANDARD_MARKERS: { agents: string; knowledge: string; section: string }[] = [
  { agents: '.claude/org-rules/00-core-agents.md', knowledge: '00-core-knowledge.md', section: 'Decision register' },
  { agents: '.claude/org-rules/00-rdzen-praca-agentow.md', knowledge: '00-rdzen-wiedza.md', section: 'Rejestr decyzji' },
]

function decisionsNoteStandard(file: string, next: string, knowledge: string, section: string): string {
  return (
    `Kokpit (decision register): append entries at the end of ${file} (next number: ${next}); rules and format: ` +
    `org-rules ${knowledge}, section "${section}". The user resolves them in the /decisions pane.`
  )
}

function decisionsNote(file: string, next: string, lang: Language): string {
  return (
    'Kokpit (decision register): when you make a design decision on the user\'s behalf that waits for their ' +
    `confirmation, or leave them an open question, append an entry at the end of ${file} (next number: ${next}) ` +
    'instead of leaving "to be confirmed" in other documents; put only a reference (D-NNN) there. Entry format: ' +
    `${entryFormat(lang)}. The user resolves entries in the /decisions pane; never change a status yourself.`
  )
}

/** Language of new register entries: the one the register is already written in, otherwise the setting. */
export function registerLanguage(ds: Decision[], setting: Language): Language {
  return ds.length ? (ds[ds.length - 1]?.language ?? setting) : setting
}

const COMPACT_NOTE =
  'Kokpit: if the conversation has a thread file in .claude/handoffs/, give its path in the summary. Carry the ' +
  "user's decisions, rejected approaches and their remarks or corrections over verbatim; do not summarize them."

/** Text instead of the /handoff skill in plan mode (file writes are blocked then). */
const PLAN_NOTE =
  'Kokpit: the session is in plan mode, so the handoff is postponed; it starts by itself after plan mode ends. ' +
  'Do not save the session state anywhere (not to the plan file either). Say so in one sentence and get back to work.'

/** Handoff thread headings by language (the validator accepts both sets). */
export const THREAD_HEADINGS: Record<Language, string[]> = {
  en: [
    'Goal',
    'Current state',
    'Decisions',
    'Tried and dropped',
    'User notes and pitfalls',
    'Evidence and numbers',
    'Open questions',
    'Next steps',
    'Quick start',
    'Log',
    'Archive',
  ],
  pl: [
    'Cel',
    'Stan teraz',
    'Decyzje',
    'Próbowaliśmy i odpadło',
    'Uwagi użytkownika i pułapki',
    'Dowody i liczby',
    'Otwarte pytania',
    'Następne kroki',
    'Szybki start',
    'Dziennik',
    'Archiwum',
  ],
}

/** Appended to the handoff skill: which language a new thread is written in. */
export function handoffLanguageNote(lang: Language): string {
  if (lang === 'en') {
    return (
      '\n\n## Language\n\nWrite a new thread in English with the headings from the template. An existing thread ' +
      'keeps its language and headings (a Polish thread uses ' +
      THREAD_HEADINGS.pl.map(h => `"## ${h}"`).join(', ') +
      ' and the archive file `<thread>.archiwum.md`).'
    )
  }
  return (
    '\n\n## Language\n\nKokpit is set to Polish: write a new thread in Polish, with these headings in this order ' +
    'instead of the English ones: ' +
    THREAD_HEADINGS.pl.map(h => `"## ${h}"`).join(', ') +
    '; the older log entries go to "## Dziennik (starsze)" and the archive file is `<thread>.archiwum.md`. ' +
    'An existing thread keeps its language and headings.'
  )
}

/** Appended to the setup skill: language of the repo-standard templates. */
export function setupLanguageNote(lang: Language): string {
  return (
    `\n\n## Language\n\nKokpit's language for generated files is "${lang}": pass \`--lang ${lang}\` to ` +
    '`standard init` unless the repo already follows the standard in the other language (then keep that one).'
  )
}

/** Agent statuses whose result is still to come to this session. */
const AGENT_BUSY = ['pending', 'running', 'waiting']

/**
 * What in this session's background is still working: agents, Kokpit jobs, background commands from the last
 * Stop. Their results come only to this conversation; a /clear before them would lose them.
 */
export function busyLabels(
  agents: { status: string; description: string; type: string; teammateId?: string }[],
  jobs: { endedAt: number | null; label: string }[],
  tasks: { type: string; description: string }[],
): string[] {
  return [
    // A companion chat (nested or detached) is a separate conversation: it waits for the user, not for us.
    ...agents
      .filter(a => AGENT_BUSY.includes(a.status) && a.type !== 'teammate' && !a.teammateId)
      .map(a => a.description || a.type),
    ...jobs.filter(j => j.endedAt === null).map(j => j.label),
    // Subagents are already in the agent list.
    ...tasks.filter(t => t.type !== 'subagent').map(t => t.description || t.type),
  ]
}

/** A reading from session.measure or $.session.usage() in one shape. */
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

/** Token threshold: the setting, but never beyond 75% of the model's window. */
export function thresholdFor(setting: number, window: number): number {
  return Math.min(setting, Math.floor(window * WINDOW_CAP))
}

/**
 * Hard threshold: the setting (0 = soft + 100k), never beyond 85% of the window and never below the soft one.
 * From it on a handoff starts at the end of a turn even mid-work, so the context does not grow without end.
 */
export function hardThresholdFor(soft: number, setting: number, window: number): number {
  const wanted = setting > 0 ? setting : soft + HARD_EXTRA
  return Math.max(soft, Math.min(wanted, Math.floor(window * HARD_CAP)))
}

/** Whether the band offers a handoff: threshold passed, not snoozed, not right after the previous one. */
export function isDue(tokens: number | null, threshold: number, h: Handoff): boolean {
  if (tokens === null || h.running) return false
  if (tokens < threshold || tokens < h.snoozedUntil) return false
  return h.lastTokens === 0 || tokens >= h.lastTokens + STEP_TOKENS
}

/**
 * Whether a handoff starts by itself at the end of a turn. One per conversation (never again after a save),
 * from the soft threshold only after a finished task, from the hard one always; "Later" snoozes both.
 */
export function autoDue(tokens: number | null, soft: number, hard: number, h: Handoff, finished: boolean): boolean {
  if (tokens === null || h.running || h.lastTokens > 0) return false
  if (tokens < h.snoozedUntil) return false
  if (tokens >= hard) return true
  return tokens >= soft && finished
}

/** A task is finished: the whole list is checked off, or there is no list. */
export function isFinished(tasks: Task[]): boolean {
  return tasks.every(t => t.status === 'completed')
}

/** Whether an answer ends with a question to the user (the last non-empty line ends with "?"). */
export function endsWithQuestion(answer: string): boolean {
  const lines = answer.split('\n').map(l => l.trim()).filter(Boolean)
  return /\?[*_)\]»”"'`]*$/.test(lines[lines.length - 1] ?? '')
}

/** A call to the desktop app's task list (`mcp__ccd_turn__update_plan`). */
export type PlanCall = {
  items?: { content?: unknown; status?: unknown }[]
  advance?: unknown
  done?: unknown
  start?: unknown
}

function planStatus(status: unknown): TaskStatus {
  return status === 'in_progress' || status === 'completed' ? status : 'pending'
}

/** The task list after `update_plan`: a new list, checking off (`done`), starting (`start`), a step on (`advance`). */
export function applyPlan(tasks: Task[], call: PlanCall): Task[] {
  let ts = Array.isArray(call.items)
    ? call.items.map((it, i) => ({ id: 'plan-' + (i + 1), subject: String(it.content ?? ''), status: planStatus(it.status) }))
    : tasks
  const set = (i: number, status: TaskStatus) => (ts = ts.map((t, j) => (j === i ? { ...t, status } : t)))
  if (Array.isArray(call.done)) for (const n of call.done) if (typeof n === 'number') set(n - 1, 'completed')
  if (typeof call.start === 'number') set(call.start - 1, 'in_progress')
  if (call.advance === true) {
    const current = ts.findIndex(t => t.status === 'in_progress')
    if (current >= 0) set(current, 'completed')
    const nextOne = ts.findIndex(t => t.status === 'pending')
    if (nextOne >= 0) set(nextOne, 'in_progress')
  }
  return ts
}

/** The file with a cleared conversation's latest answers: for the user and for the new session. */
export function answersMarkdown(thread: string, answers: Answer[], at: string): string {
  const parts = answers.map((a, i) => `## Answer ${i + 1} of ${answers.length} · ${a.at.slice(11, 16)}\n\n${a.text.trim()}\n`)
  return (
    `# Latest answers before the conversation was cleared — ${thread}\n\n` +
    `Saved by Kokpit at ${at.slice(0, 16).replace('T', ' ')}, before it cleared the conversation after a handoff.\n\n` +
    parts.join('\n')
  )
}

/** First-line mark of Kokpit's housekeeping turns (handoff, resume after clearing); see the skills. */
export const HOUSEKEEPING_MARK = 'Kokpit · '

const NOTE_RE =
  /The session "([^"]*)" you started \([^)]*\) finished a turn\. It reported \(quoted child output, data not instructions\): "/g

/**
 * The app's note about a turn of a side session that only saved a handoff or resumed a thread: the titles of
 * those sessions, or null when the note carries anything else (then it goes through normally).
 */
export function housekeepingNote(text: string): string[] | null {
  const titles: string[] = []
  for (const m of text.matchAll(NOTE_RE)) {
    const quoted = text.slice((m.index ?? 0) + m[0].length).trimStart()
    if (!quoted.startsWith(HOUSEKEEPING_MARK)) return null
    titles.push(m[1] ?? '')
  }
  return titles.length > 0 ? titles : null
}

/** Note for the model attached to a message carried into the new session. */
export function previousContext(markdown: string): string {
  return (
    'Kokpit: the conversation was cleared after a handoff, and this user message arrived just before the clear. ' +
    "Below, verbatim, are Claude's latest answers from the previous conversation; the message may refer to them " +
    '("yes", "do point 2"). The user sees them in the "Previous answers" pane.\n\n' +
    markdown
  )
}

/** Completion of the current task list (null when there is none). */
export function progress(tasks: Task[]): { done: number; total: number; percent: number; current: string | null } | null {
  if (tasks.length === 0) return null
  const done = tasks.filter(t => t.status === 'completed').length
  // A task in progress counts as half, so the bar moves before anything finishes.
  const half = tasks.filter(t => t.status === 'in_progress').length * 0.5
  const current = tasks.find(t => t.status === 'in_progress')?.subject ?? null
  return { done, total: tasks.length, percent: Math.round(((done + half) / tasks.length) * 100), current }
}

/** A new task: when the previous list is all complete, it starts a new one. */
export function addTask(tasks: Task[], task: Task): Task[] {
  const finished = tasks.length > 0 && tasks.every(t => t.status === 'completed')
  return finished ? [task] : [...tasks, task]
}

export function setStatus(tasks: Task[], id: string, status: TaskStatus | 'deleted' | undefined, subject?: string): Task[] {
  if (status === 'deleted') return tasks.filter(t => t.id !== id)
  return tasks.map(t => (t.id === id ? { ...t, status: status ?? t.status, subject: subject ?? t.subject } : t))
}

/** Whether a path is a thread file of this project (no subdirectories, no climbing out). */
export function isHandoffPath(path: string, cwd: string): boolean {
  const dir = cwd.replace(/\/+$/, '') + '/' + HANDOFF_DIR + '/'
  if (!path.startsWith(dir) || path.includes('..')) return false
  const name = path.slice(dir.length)
  return name.endsWith('.md') && !name.includes('/')
}

/** A thread's archive file (archive and older log entries): it sits next to the thread but is not one. */
export const ARCHIVE_SUFFIXES = ['.archive.md', '.archiwum.md']

/** Whether a name (or path) is a thread file rather than its archive. */
export function isThreadFile(name: string): boolean {
  return name.endsWith('.md') && !ARCHIVE_SUFFIXES.some(s => name.endsWith(s))
}

/** Thread name from its path. */
export function threadName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** Handoff log summary for /kokpit. */
export function stats(log: HandoffLogEntry[], nowMs: number): string {
  const day = 24 * 3600 * 1000
  const today = new Date(nowMs).toDateString()
  const todays = log.filter(l => new Date(l.at).toDateString() === today)
  const week = log.filter(l => nowMs - new Date(l.at).getTime() < 7 * day)
  const avg = week.length ? Math.round(week.reduce((s, l) => s + l.tokens, 0) / week.length / 1000) : 0
  const threads = new Set(week.map(l => l.thread)).size
  const modes = week.map(l => logMode(l.mode))
  const refreshed = modes.filter(m => m === 'refresh').length
  return (
    `Handoffs today: ${todays.length} · last 7 days: ${week.length} in ${threads} threads` +
    (week.length ? ` · at ${avg}k tokens on average` : '') +
    ` · automatic: ${modes.filter(m => m === 'break' || m === 'auto').length}` +
    (refreshed ? ` · refreshed on a message: ${refreshed}` : '')
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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "14:20" for the 5-hour limit, "Fri 09:00" for the weekly one. */
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

// Module state (lost on reload: these are only details of the current turn).
/** In this turn `wrap_up` asked the user a question (`ask`). */
let askedThisTurn = false
let currentTurnId = ''
let pendingMode: LogMode = 'button'
let pendingTokens = 0
/** Commands and other background tasks from the last classic.Stop (the engine reports them only there). */
let lastBackground: { type: string; description: string }[] = []
/** The main loop is inside a turn (a background result sent now would land after it, maybe after a question). */
let turnRunning = false
/** Background results that arrived during a turn: at its end we decide whether they go to Claude or wait. */
let afterTurn: InboxItem[] = []

async function backgroundWork($: EngineInterface): Promise<string[]> {
  let agents: { status: string; description: string; type: string; teammateId?: string }[] = []
  try {
    agents = await $.agent.list()
  } catch {
    // Without the agent list, Kokpit jobs and background commands still count.
  }
  return busyLabels(agents, await read($, jobsAtom), lastBackground)
}

// ── Economy: per-project settings, difficulty rating, stats ──

/** Collected in the current turn (steps, ratings, subagents), stored at the end of the turn. */
let economyTurn: EconomyStats = emptyStats('')
/** Main-conversation model and effort from the last step: the no-Economy scenario for subagents. */
let lastMainModel = ''
let lastMainEffort: Level | null = null
/** Subagent type by id (Explore without Economy would run on Haiku). */
const agentTypes = new Map<string, string>()
/** Failed tool calls in subagents (by id): each raises the effort of that subagent's next steps. */
const agentErrors = new Map<string, number>()
/** Cost (API prices) measured since the last weekly reading, for calibration at the next one. */
let accruedCost = 0
/** Whether opencode exists on this machine (the local model's "code" mode); checked when Economy loads. */
let opencodeOk = false

async function hasCommand($: EngineInterface, name: string): Promise<boolean> {
  try {
    return (await $.process.run(['bash', '-lc', `command -v ${name}`])).exitCode === 0
  } catch {
    return false
  }
}

/** Ollama models and whether opencode exists, for the pane. */
async function refreshLocal($: EngineInterface): Promise<void> {
  let models: string[] = []
  let ollama = false
  try {
    const r = await $.process.run(['bash', '-lc', 'ollama list'])
    ollama = r.exitCode === 0
    if (ollama) models = parseOllamaList(r.stdout)
  } catch {
    ollama = false
  }
  opencodeOk = await hasCommand($, 'opencode')
  await update($, localAtom, () => ({ models, opencode: opencodeOk, ollama }))
}

/** A store value under its current key, falling back to keys of older versions (copied over on first read). */
async function migrated($: EngineInterface, key: string, legacy: string[]): Promise<unknown> {
  const value = await $.store.get(key)
  if (value !== undefined) return value
  for (const old of legacy) {
    const v = await $.store.get(old)
    if (v !== undefined) {
      await $.store.set(key, v)
      return v
    }
  }
  return undefined
}

/** Calibration and plan are shared by all projects (it is one account limit). */
const CALIBRATION_KEY = 'economy-calibration'
const PLAN_KEY = 'economy-plan'

function asPlan(x: unknown): Plan {
  return x === 'pro' || x === 'x5' ? x : 'x20'
}

async function readPlan($: EngineInterface): Promise<Plan> {
  return asPlan(await migrated($, PLAN_KEY, ['ekonom-plan']))
}

/** Calibration is separate for each plan: a Pro week is a different number of dollars than a Max x20 week. */
async function readCalibrationFor($: EngineInterface, plan: Plan): Promise<Calibration> {
  // Before 0.8 there was one calibration, measured on Max x20 (the only plan known then).
  const legacy = [`ekonom-kalibracja:${plan}`, ...(plan === 'x20' ? ['ekonom-kalibracja'] : [])]
  return parseCalibration(await migrated($, `${CALIBRATION_KEY}:${plan}`, legacy))
}

async function setPlan($: EngineInterface, plan: Plan): Promise<void> {
  await $.store.set(PLAN_KEY, plan)
  const calibration = await readCalibrationFor($, plan)
  await update($, calibrationAtom, () => ({ calibration, plan }))
}

async function readCalibration($: EngineInterface): Promise<{ calibration: Calibration; plan: Plan }> {
  const plan = await readPlan($)
  return { calibration: await readCalibrationFor($, plan), plan }
}

/** A weekly reading from the session measure: closes the calibration increment with the cost since the last one. */
async function calibrate($: EngineInterface, weekPercent: number): Promise<void> {
  const cost = accruedCost
  accruedCost = 0
  const plan = await readPlan($)
  const before = await readCalibrationFor($, plan)
  const after = calibrationReading(calibrationAddCost(before, cost), weekPercent)
  if (JSON.stringify(after) === JSON.stringify(before)) return
  await $.store.set(`${CALIBRATION_KEY}:${plan}`, after)
  const cur = await read($, calibrationAtom)
  if (cur) await update($, calibrationAtom, x => (x ? { ...x, calibration: after } : x))
}

let projectRootCache: { root: string; project: string } | null = null

/**
 * Project root shared by all worktrees: the directory above the common `.git` (git --git-common-dir).
 * Outside a repo or without git: the session root.
 */
async function projectRoot($: EngineInterface): Promise<string> {
  const root = (await $.session.root()).replace(/\/+$/, '')
  if (projectRootCache?.root === root) return projectRootCache.project
  let project = root
  try {
    const r = await $.process.run(['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    const dir = r.exitCode === 0 ? r.stdout.trim() : ''
    if (dir.endsWith('/.git')) project = dir.slice(0, -'/.git'.length)
  } catch {
    // no git: the session root
  }
  projectRootCache = { root, project }
  return project
}

async function settingsKey($: EngineInterface): Promise<string> {
  return `economy:${await projectRoot($)}`
}

async function statsKey($: EngineInterface): Promise<string> {
  return `economy-stats:${await projectRoot($)}`
}

/**
 * Loads the project's settings as active for this conversation. Only at start and after /clear: a prompt and
 * tool list changed mid-conversation would make the whole conversation be read again (cache).
 */
async function loadEconomy($: EngineInterface): Promise<EconomySettings> {
  const project = await projectRoot($)
  const sessionRoot = (await $.session.root()).replace(/\/+$/, '')
  // Before 0.6.3 settings were keyed by the worktree root; before 0.10 the key was Polish.
  const saved = parseSettings(await migrated($, await settingsKey($), [`ekonom:${project}`, `ekonom:${sessionRoot}`]))
  if (saved.split) {
    for (const a of HAIKU_AGENTS) {
      try {
        await $.agent.register({ ...a, omitClaudeMd: a.name === 'reporter' } as never)
      } catch {
        // already registered, or the session is not ready yet
      }
    }
  }
  if (saved.local && saved.localModel) {
    opencodeOk = await hasCommand($, 'opencode')
    try {
      await $.tool.register({
        name: LOCAL_TOOL,
        description:
          'Hands a simple task to a local Ollama model (in the background, returns at once; the result arrives as a ' +
          'message). mode "text": an answer to the brief; mode "code": opencode in a separate worktree, the result ' +
          "as a diff to review. When to use it: Kokpit's note in the system prompt.",
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['text', 'code'] },
            task: { type: 'string', description: 'A self-contained brief: files, pattern, acceptance criteria.' },
            label: { type: 'string', description: 'A short name for the band.' },
          },
          required: ['mode', 'task'],
        },
      })
    } catch {
      // already registered in this process
    }
  }
  await update($, economyAtom, () => ({ ...ECONOMY_0, active: saved, saved }))
  if (saved.effort) {
    try {
      await $.tool.register({
        name: RATING_TOOL,
        description:
          'Difficulty rating of the current request for Kokpit, which matches your reasoning level to it. Call it as ' +
          "Kokpit's note in the system prompt says (in parallel with the first tool call).",
        inputSchema: {
          type: 'object',
          properties: {
            rating: { type: 'string', enum: RATINGS },
            reason: { type: 'string', description: 'A few words: why this rating.' },
          },
          required: ['rating'],
        },
      })
    } catch {
      // already registered in this process (e.g. after /clear)
    }
  }
  return saved
}

async function saveEconomy($: EngineInterface, change: (s: EconomySettings) => EconomySettings): Promise<void> {
  const next = change((await read($, economyAtom)).saved)
  await $.store.set(await settingsKey($), next)
  await update($, economyAtom, x => ({ ...x, saved: next }))
}

async function readEconomyStats($: EngineInterface): Promise<EconomyStats> {
  const at = new Date(await $.clock.now()).toISOString()
  return parseStats(await migrated($, await statsKey($), [`ekonom-stat:${await projectRoot($)}`]), at)
}

async function flushEconomyStats($: EngineInterface): Promise<void> {
  const d = economyTurn
  economyTurn = emptyStats('')
  const empty = !Object.keys(d.steps).length && !Object.keys(d.ratings).length && !Object.keys(d.subagents).length
  if (empty) return
  const merged = mergeStats(await readEconomyStats($), d)
  await $.store.set(await statsKey($), merged)
  await update($, economyStatsAtom, () => merged)
}

/** Runs a plugin skill; the bare name works when nothing else takes it. */
async function runSkill($: EngineInterface, name: string, args: string): Promise<void> {
  try {
    await $.command.run({ command: 'kokpit:' + name, args })
  } catch {
    await $.command.run({ command: name, args })
  }
}

async function startHandoff($: EngineInterface, mode: LogMode): Promise<void> {
  const usage = await read($, usageAtom)
  const now = await $.clock.now()
  await update($, handoffAtom, h => ({ ...h, running: true, startedAt: now, savedPath: null }))
  pendingMode = mode
  pendingTokens = usage?.contextTokens ?? 0
  try {
    await runSkill($, 'handoff', '')
  } catch (err) {
    await update($, handoffAtom, h => ({ ...h, running: false }))
    $.ui.toast('Could not start /handoff: ' + String(err))
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
  pendingMode = 'button'
  pendingTokens = 0
}

/** Toast when a message is held for a handoff or a refresh (that takes about a minute). */
const LONG_TOAST_MS = 30_000

/**
 * A message held for the new session. The desktop app shows `drop` as "Prompt blocked by a hook" and hides
 * the reason in the details, so the same text also goes out as a toast.
 */
function heldNotice($: EngineInterface, what: string, timeoutMs?: number): { drop: string } {
  const text = 'Kokpit: your message is waiting (not an error) — ' + what
  $.ui.toast(text, timeoutMs ? { timeoutMs } : undefined)
  return { drop: text }
}

/** A user message held for the new session (later ones are appended below). */
async function holdPrompt($: EngineInterface, text: string): Promise<void> {
  const held = (await flowGet($, 'pendingPrompt')) as string | undefined
  await flowSet($, 'pendingPrompt', held ? held + '\n\n' + text : text)
}

/** The clear did not happen: the held message goes to this conversation instead of getting lost. */
async function flushPrompt($: EngineInterface): Promise<void> {
  const held = (await flowGet($, 'pendingPrompt')) as string | undefined
  if (!held) return
  await flowDelete($, 'pendingPrompt')
  await $.prompt.submit({ text: held, asUser: true })
}

/** Background results as one block of text (context for an answer, or a message in the new session). */
function inboxText(items: InboxItem[]): string {
  return items
    .map(x => 'Kokpit — a background result that arrived while Claude was waiting for the user:\n' + x.text)
    .join('\n\n')
}

async function takeInbox($: EngineInterface): Promise<InboxItem[]> {
  const items = await read($, inboxAtom)
  if (items.length > 0) await update($, inboxAtom, () => [])
  return items
}

/**
 * A background result for Claude. Sent at once only in a quiet session that is not waiting for the user; during
 * a turn it waits for the turn's end (the turn may end with a question), after a question for the answer.
 */
async function deliver($: EngineInterface, item: InboxItem): Promise<void> {
  if (turnRunning) {
    afterTurn = [...afterTurn.filter(x => x.id !== item.id), item]
    return
  }
  if ((await read($, handoffAtom)).awaiting) {
    await update($, inboxAtom, xs => [...xs.filter(x => x.id !== item.id), item])
    return
  }
  await $.prompt.submit({ text: item.text })
}

/** End of a main-loop turn: results that arrived during it go on, or wait for the answer. */
async function releaseAfterTurn($: EngineInterface, hold: boolean): Promise<void> {
  const items = afterTurn
  afterTurn = []
  if (items.length === 0) return
  if (hold) {
    await update($, inboxAtom, xs => [...xs.filter(x => !items.some(i => i.id === x.id)), ...items])
    return
  }
  for (const item of items) await $.prompt.submit({ text: item.text })
}

async function sendInboxNow($: EngineInterface, id: string): Promise<void> {
  const item = (await read($, inboxAtom)).find(x => x.id === id)
  if (!item) return
  await update($, inboxAtom, xs => xs.filter(x => x.id !== id))
  await $.prompt.submit({ text: item.text })
}

/** The conversation's last two answers, saved next to the thread: after /clear they stay for the user and the new session. */
async function saveAnswers($: EngineInterface, threadPath: string): Promise<void> {
  const answers = await read($, answersAtom)
  if (answers.length === 0) return
  const thread = threadName(threadPath)
  const file = await inProject($, `${ANSWERS_DIR}/${thread}.md`)
  try {
    await $.fs.write(file, answersMarkdown(thread, answers, new Date(await $.clock.now()).toISOString()))
    await flowSet($, 'pendingPrevious', file)
  } catch {
    // Without the file the clear still goes ahead: the thread has the state of the work.
  }
}

/** /clear and resuming the thread in a new session (through $.store, because /clear ends this session). */
async function clearAndResume($: EngineInterface, path: string, force = false): Promise<void> {
  // Background work of this session would deliver its result to a conversation that no longer exists: wait for
  // it (turn.complete). "Clear anyway" (force) skips the wait, so waiting is never a dead end.
  const busy = force ? [] : await backgroundWork($)
  if (busy.length > 0) {
    await update($, handoffAtom, h => ({ ...h, clearAfter: false, clearWhenIdle: true, busy }))
    $.ui.toast(`Still running in the background: ${busy.join(', ')}. I will clear after their results, adding them to the thread first.`)
    await flushPrompt($)
    return
  }
  await update($, handoffAtom, h => ({ ...h, clearAfter: false, clearWhenIdle: false, busy: undefined }))
  // Held background results go to the new session with the user's message instead of being lost with this one.
  const held = await takeInbox($)
  if (held.length > 0) await holdPrompt($, inboxText(held))
  await saveAnswers($, path)
  await flowSet($, 'pendingResume', await inProject($, path))
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch {
    $.ui.toast('Type /clear and Kokpit will run /resume by itself')
    await flowDelete($, 'pendingResume')
    await flushPrompt($)
  }
}

/**
 * "Clear and resume" button / manual /clear / a message: refresh a stale thread first, clear only then.
 * A refresh triggered by a message has its own log mode (`refresh`); the rest is `button`.
 */
async function refreshThenClear($: EngineInterface, mode: LogMode = 'button'): Promise<void> {
  await update($, handoffAtom, h => ({ ...h, clearAfter: true }))
  await startHandoff($, mode)
}

async function threadFiles($: EngineInterface): Promise<{ path: string; mtimeMs: number }[]> {
  const dir = await inProject($, HANDOFF_DIR)
  if (!(await $.fs.exists(dir))) return []
  const files: { path: string; mtimeMs: number }[] = []
  for (const entry of await $.fs.list(dir)) {
    if (entry.kind !== 'file' || !isThreadFile(entry.name)) continue
    const path = dir + '/' + entry.name
    files.push({ path, mtimeMs: (await $.fs.stat(path)).mtimeMs })
  }
  return files
}

async function findResumable($: EngineInterface): Promise<string | null> {
  return pickSaved(await threadFiles($), 0)
}

/** The newest thread file saved since `since` (with 2 s of slack for clock skew), or null. */
export function pickSaved(files: { path: string; mtimeMs: number }[], since: number): string | null {
  let best: { path: string; mtimeMs: number } | null = null
  for (const f of files) {
    if (f.mtimeMs + 2000 < since) continue
    if (best === null || f.mtimeMs > best.mtimeMs) best = f
  }
  return best ? best.path : null
}

/**
 * End of a turn during a handoff: a thread file saved since the start → done; nothing saved → drop "Writing".
 * It does not rely on catching a specific Write/Edit (relative path, a write from Bash, another surface).
 */
async function finishHandoff($: EngineInterface, aborted: boolean): Promise<void> {
  const h = await read($, handoffAtom)
  if (!h.running) return
  let files: { path: string; mtimeMs: number }[] = []
  try {
    files = await threadFiles($)
  } catch {
    // no directory or a read error = nothing saved
  }
  const saved = pickSaved(files, h.startedAt)
  if (saved) {
    await noteSaved($, saved)
    return
  }
  await update($, handoffAtom, x => ({ ...x, running: false, clearAfter: false }))
  pendingMode = 'button'
  pendingTokens = 0
  const why = aborted ? 'Handoff interrupted: the thread file is unchanged.' : 'The handoff did not save a thread file.'
  $.ui.toast(h.clearAfter ? why + ' Not clearing the conversation.' : why)
  // A message held for the handoff goes to this conversation.
  await flushPrompt($)
}

// ── Per-repo tools (/tools) ──

const SETTINGS_FILE = '.claude/settings.json'

function setupScript($: EngineInterface, name: string): string {
  return `${$.plugin.root}/skills/setup/scripts/${name}`
}

/** Tool state in this repo: graphify (machine, hooks, setup verdict) and skills hidden from the model. */
async function refreshTools($: EngineInterface): Promise<void> {
  const root = await $.session.root()
  const settingsFile = await inProject($, SETTINGS_FILE)
  let graphifyInstalled = false
  let share: number | null = null
  let fits = false
  try {
    graphifyInstalled = (await $.process.run(['bash', '-lc', 'command -v graphify'])).exitCode === 0
  } catch {
    // no login shell = treat as no graphify
  }
  try {
    const r = await $.process.run(
      ['python3', '-I', setupScript($, 'setup.py'), 'graph', root, setupScript($, 'graphify_extensions.txt')],
      { timeoutMs: 20_000 },
    )
    share = parseShare(r.stdout)
    fits = r.exitCode === 0
  } catch {
    // no python3, no verdict
  }
  let graphOn = false
  try {
    graphOn = (await $.fs.exists(settingsFile)) && (await $.fs.read(settingsFile)).includes('graphify')
  } catch {
    // unreadable settings = no hooks
  }
  let hidden: string[] = []
  try {
    const project = (await $.settings.read({ source: 'project' })) as { skillOverrides?: Record<string, unknown> }
    hidden = hiddenSkills(project.skillOverrides)
  } catch {
    // without project settings nothing is hidden
  }
  let skills: ToolsInfo['skills'] = []
  try {
    skills = (await $.command.list())
      .filter(c => c.source === 'user')
      .map(c => ({ name: c.name, description: c.description }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    // without the command list only the hidden ones remain
  }
  await update($, toolsAtom, () => ({ graphifyInstalled, graphOn, share, fits, hidden, skills }))
}

/** Hides a skill from the model in this repo or restores it (`skillOverrides` in .claude/settings.json). */
async function setSkillHidden($: EngineInterface, name: string, hide: boolean): Promise<void> {
  try {
    const file = await inProject($, SETTINGS_FILE)
    const text = (await $.fs.exists(file)) ? await $.fs.read(file) : null
    await $.fs.write(file, withSkill(text, name, hide))
    $.ui.toast(hide ? `Skill ${name} hidden from the model in this repo (/${name} still works).` : `Skill ${name} visible to the model again.`)
  } catch (err) {
    $.ui.toast(`Not changing ${SETTINGS_FILE}: ${String(err instanceof Error ? err.message : err)}`)
  }
  await refreshTools($)
}

// ── Decision register ──

async function readDecisions($: EngineInterface, file: string): Promise<Decision[]> {
  try {
    const path = await inProject($, file)
    if (!(await $.fs.exists(path))) return []
    return parseDecisions(await $.fs.read(path))
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
  status: 'accepted' | 'rejected' | 'changed',
  answer?: string,
): Promise<void> {
  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const path = await inProject($, file)
  const text = await $.fs.read(path)
  await $.fs.write(path, resolveDecision(text, id, status, date, answer))
  await refreshDecisions($, file)
  $.ui.invalidate('ui.render')
}

// ── Background jobs ──

/** Job output (for "Show Claude" and the log); lost when the module reloads. */
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
  // No await: the loop lives on after the hook returns, until the process ends.
  void runJob($, job, argv)
  return id
}

async function runJob($: EngineInterface, job: Job, argv: string[]): Promise<void> {
  // The wrapper reports the PID so "Stop" can kill the process together with its children.
  const wrapped = ['bash', '-c', `echo "${PID_MARK} $$"; exec "$@"`, 'kokpit', ...argv]
  const ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  let output = ''
  let partial = ''
  let current = job
  let code: number | null = null
  try {
    // In the project root: job commands use relative paths, and `cd` in Bash moves the session directory.
    const stream = $.process.spawn({ argv: wrapped, cwd: await $.session.root() })
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
    const dir = await inProject($, JOBS_DIR)
    await $.process.run(['mkdir', '-p', dir])
    logPath = `${dir}/${job.id}.log`
    await $.fs.write(logPath, output)
  } catch {
    logPath = null
  }
  const ended: Job = { ...current, endedAt: await $.clock.now(), code, logPath }
  await setJob($, job.id, () => ended)
  if (job.byClaude) {
    await deliver($, { id: ended.id, label: ended.label, text: resultPrompt(ended, output) })
  } else {
    $.ui.toast(`${ended.code === 0 ? '✓' : '✗'} ${ended.label} finished`)
  }
}

async function stopJob($: EngineInterface, id: string): Promise<void> {
  const pid = pids.get(id)
  if (!pid || !/^\d+$/.test(pid)) return
  await $.process.run(['bash', '-c', `pkill -TERM -P ${pid}; kill -TERM ${pid}`])
}

async function readProjectConfig($: EngineInterface): Promise<ProjectConfig> {
  const file = await inProject($, PROJECT_CONFIG)
  if (!(await $.fs.exists(file))) return {}
  return parseProjectConfig(await $.fs.read(file))
}

/** What a background request runs: the tests, a named job, or a shell command. Throws with a readable reason. */
export function jobCommand(
  config: ProjectConfig,
  kind: 'tests' | 'job' | 'command',
  args: string,
): { kind: Job['kind']; label: string; command: string } {
  const parts = splitArgs(args)
  if (kind === 'tests') {
    if (!config.tests) throw new Error(`No test command: set "tests" in ${PROJECT_CONFIG}, e.g. {"tests": "npm test --"}.`)
    return { kind: 'tests', label: parts.length ? 'tests ' + parts.join(' ') : 'tests (all)', command: fillCommand(config.tests, parts) }
  }
  if (kind === 'job') {
    const [name = '', ...rest] = parts
    const template = config.jobs?.[name]
    if (!template) {
      const known = Object.keys(config.jobs ?? {})
      throw new Error(`No job "${name}" in ${PROJECT_CONFIG}` + (known.length ? ` (known: ${known.join(', ')}).` : '.'))
    }
    return { kind: 'job', label: [name, ...rest].join(' ').slice(0, 40), command: fillCommand(template, rest) }
  }
  if (!args.trim()) throw new Error('No command given.')
  return { kind: 'command', label: args.trim().slice(0, 40), command: args }
}

async function runRequest(
  $: EngineInterface,
  kind: 'tests' | 'job' | 'command',
  args: string,
  byClaude: boolean,
  label?: string,
): Promise<string> {
  const job = jobCommand(await readProjectConfig($), kind, args)
  return startJob($, job.kind, (label ?? '').trim() || job.label, shellArgv(job.command), byClaude)
}

/** The register file: the setting, else the one that exists, else the default for the language. */
async function decisionsPath($: EngineInterface, setting: string, lang: Language): Promise<string> {
  if (setting) return setting
  for (const candidate of ['docs/decisions.md', 'docs/decyzje.md']) {
    if (await $.fs.exists(await inProject($, candidate)).catch(() => false)) return candidate
  }
  return lang === 'pl' ? 'docs/decyzje.md' : 'docs/decisions.md'
}

export const register: Register = (on, options) => {
  const mode = parseMode(options?.handoffMode)
  const tokensSetting =
    typeof options?.handoffTokens === 'number' && options.handoffTokens > 0 ? options.handoffTokens : 150_000
  const hardSetting =
    typeof options?.handoffHardTokens === 'number' && options.handoffHardTokens > 0 ? options.handoffHardTokens : 0
  const clearMode = parseClearMode(options?.handoffClear)
  const nudge = options?.taskNudge !== false
  const language = parseLanguage(options?.language)
  const decisionsSetting = typeof options?.decisionsFile === 'string' ? options.decisionsFile.trim() : ''
  /** Resolved per session (the file may appear later); see decisionsPath. */
  let decisionsFile = decisionsSetting || (language === 'pl' ? 'docs/decyzje.md' : 'docs/decisions.md')

  on('session.start', async ($, e, next) => {
    const usage = toUsage(await $.session.usage())
    await update($, usageAtom, () => usage)
    // A new session has no handoff in progress; "Writing" left from a reload or /clear is a stuck state.
    await update($, handoffAtom, h => (h.running ? { ...h, running: false } : h))
    decisionsFile = await decisionsPath($, decisionsSetting, language)
    await refreshDecisions($, decisionsFile)
    try {
      await loadEconomy($)
    } catch {
      // without the store Economy stays off
    }
    // Store leftovers: keys of old code and /clear bridges of windows closed mid-clear.
    try {
      const keys = await $.store.keys()
      const values: Record<string, unknown> = {}
      for (const k of keys) if (k.startsWith('pendingAt:')) values[k] = await $.store.get(k)
      for (const k of orphanKeys(keys, values, await $.clock.now())) await $.store.delete(k)
    } catch {
      // without the key list the leftovers stay; nothing reads them
    }
    await $.tool.register({
      name: BACKGROUND_TOOL,
      description:
        'Runs a long command in the background (tests, a benchmark, a build) and returns at once: keep working, ' +
        "the result arrives as a separate message from Kokpit and the progress shows in the band above the prompt. " +
        'Use it instead of Bash for anything that takes longer than ~1 minute. kind: "tests" (args = filters for ' +
        `the project's test command from ${PROJECT_CONFIG}), "job" (first arg = a job name from that file, the rest ` +
        'its arguments), "command" (args = one shell command). Runs in the project root.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['tests', 'job', 'command'] },
          args: { type: 'string', description: 'Arguments as in a shell; for "command" the whole command.' },
          label: { type: 'string', description: 'A short name for the band, e.g. "Benchmark level 3".' },
        },
        required: ['kind'],
      },
    })
    // Commands last: registering a taken name throws and would abort the rest of the hook.
    await $.command.register({ name: 'kokpit', description: 'Kokpit: project settings, Economy, stats, handoff', immediate: true })
    await $.command.register({ name: 'decisions', description: 'Decision register: entries waiting for your ruling', immediate: true })
    await $.command.register({ name: 'tests', description: `Tests in the background ("tests" in ${PROJECT_CONFIG}); args are passed on`, argumentHint: '[filters]', immediate: true })
    await $.command.register({ name: 'job', description: `A job from ${PROJECT_CONFIG} or any shell command in the background`, argumentHint: '<job | command> [args]', immediate: true })
    await $.command.register({ name: 'tools', description: 'Tools in this repo: graphify code graph, hidden skills, headroom', immediate: true })
    await $.command.register({ name: 'previous', description: "Claude's latest answers from before the conversation was cleared", immediate: true })
    try {
      if ((await $.session.turns()) === 0) {
        const found = await findResumable($)
        await update($, resumableAtom, () => found)
      }
    } catch {
      // No directory or no permissions: simply no "Resume" button.
    }
    return next(e)
  })

  // After /clear: $.state starts from zero, and if "Clear and resume" was pressed, /resume runs right away.
  // A message held before the clear goes right after the resume, with the latest answers in context.
  on('classic.SessionStart', { source: ['clear'] }, async ($, e, next) => {
    // After /clear the prompt is rebuilt anyway: this is when Economy changes take effect.
    await loadEconomy($).catch(() => ECONOMY_OFF)
    // This window's bridge across /clear; an expired one (a long-failed clear) is dropped with its message.
    const fresh = isFresh(await flowGet($, 'pendingAt'), await $.clock.now())
    const resume = fresh ? ((await flowGet($, 'pendingResume')) as string | undefined) : undefined
    const previous = fresh ? ((await flowGet($, 'pendingPrevious')) as string | undefined) : undefined
    const held = fresh ? ((await flowGet($, 'pendingPrompt')) as string | undefined) : undefined
    for (const key of FLOW_KEYS) await flowDelete($, key)
    if (held && !resume) $.ui.toast(`Kokpit: a held message was not sent (cleared without a resume): "${held.slice(0, 80)}"`)
    if (previous) await update($, previousAtom, () => previous)
    if (resume) {
      $.clock.after(0, async () => {
        // "after-clear": /resume only reports in and does not start step 1, because a message comes next.
        await runSkill($, 'resume', threadName(resume) + (held ? ' after-clear' : ''))
        if (held) {
          // The latest answers as a hidden conversation row: the model reads them, the user has them in the pane.
          if (previous) {
            try {
              const text = previousContext(await $.fs.read(previous))
              await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
            } catch {
              // without the file the message still goes
            }
          }
          await $.prompt.submit({ text: held, asUser: true })
        }
        if (previous) await $.ui.open({ id: PREVIOUS_PANE, title: 'Previous answers', closeOnEscape: true })
      })
    } else {
      const found = await findResumable($)
      await update($, resumableAtom, () => found)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'previous' }, async $ => {
    if (!(await read($, previousAtom))) return { text: 'No answers from before a clear in this session.' }
    await $.ui.open({ id: PREVIOUS_PANE, title: 'Previous answers', focus: true, closeOnEscape: true })
    return {}
  })

  on('command.run', { command: 'tools' }, async $ => {
    await refreshTools($)
    await $.ui.open({ id: TOOLS_PANE, title: 'Tools in this repo', focus: true, closeOnEscape: true })
    return {}
  })

  on('command.run', { command: 'kokpit' }, async $ => {
    const stats = await readEconomyStats($)
    await update($, economyStatsAtom, () => stats)
    const calibration = await readCalibration($)
    await update($, calibrationAtom, () => calibration)
    await refreshLocal($).catch(() => {})
    await $.ui.open({ id: KOKPIT_PANE, title: 'Kokpit', focus: true, closeOnEscape: true })
    return {}
  })

  // ── Decision register ──
  on('command.run', { command: 'decisions' }, async $ => {
    decisionsFile = await decisionsPath($, decisionsSetting, language)
    await refreshDecisions($, decisionsFile)
    if (!(await $.fs.exists(await inProject($, decisionsFile)))) {
      return { text: `There is no ${decisionsFile}. Ask Claude to create the register (the format is in the Kokpit README).` }
    }
    await $.ui.open({ id: DECISIONS_PANE, title: 'Decisions', focus: true, closeOnEscape: true })
    return {}
  })

  // ── Background jobs ──
  on('command.run', { command: 'tests' }, async ($, e) => {
    try {
      await runRequest($, 'tests', e.args, false)
      return { text: 'Tests started in the background; progress is in the band above the prompt.' }
    } catch (err) {
      return { text: String(err instanceof Error ? err.message : err) }
    }
  })

  on('command.run', { command: 'job' }, async ($, e) => {
    const args = e.args.trim()
    if (!args) return { text: `Give a job from ${PROJECT_CONFIG} or a command, e.g. \`/job npm run coverage\`.` }
    try {
      const name = splitArgs(args)[0] ?? ''
      const isJob = Boolean((await readProjectConfig($)).jobs?.[name])
      await runRequest($, isJob ? 'job' : 'command', args, false)
      return { text: 'Started in the background; progress is in the band above the prompt.' }
    } catch (err) {
      return { text: String(err instanceof Error ? err.message : err) }
    }
  })

  // The tool for Claude: returns at once, the result comes as a message when the job ends.
  on('tool.call', { tool: 'mcp__kokpit__background' }, async ($, e) => {
    const input = e as unknown as { kind?: string; args?: string; label?: string }
    const kind = input.kind === 'job' || input.kind === 'command' ? input.kind : 'tests'
    try {
      const id = await runRequest($, kind, input.args ?? '', true, input.label)
      return { result: `Started in the background (${id}). Keep working; the result comes as a separate message from Kokpit.` }
    } catch (err) {
      return { result: 'Not started: ' + String(err instanceof Error ? err.message : err) }
    }
  })

  on('session.measure', async ($, e, next) => {
    await update($, usageAtom, () => toUsage(e))
    const week = e.rateLimits.find(x => x.kind === 'seven_day')
    if (week && e.changed.includes('rateLimits')) await calibrate($, week.percentUsed).catch(() => {})
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const ds = await readDecisions($, decisionsFile)
    let standard: (typeof STANDARD_MARKERS)[number] | null = null
    for (const m of STANDARD_MARKERS) {
      if (await inProject($, m.agents).then(p => $.fs.exists(p)).catch(() => false)) {
        standard = m
        break
      }
    }
    const registerNote = standard
      ? decisionsNoteStandard(decisionsFile, nextId(ds), standard.knowledge, standard.section)
      : decisionsNote(decisionsFile, nextId(ds), registerLanguage(ds, language))
    const extra = [
      ...(nudge ? [{ id: 'kokpit-tasks', text: NUDGE, scope: 'session' as const }] : []),
      { id: 'kokpit-background', text: BACKGROUND_NOTE, scope: 'session' as const },
      { id: 'kokpit-decisions', text: registerNote, scope: 'session' as const },
    ]
    const eco = (await read($, economyAtom)).active
    if (eco.split) {
      const text = standard ? splitNoteStandard(standard.agents.split('/').pop() ?? '') : SPLIT_NOTE
      extra.push({ id: 'kokpit-split', text, scope: 'session' as const })
    }
    if (eco.effort) extra.push({ id: 'kokpit-effort', text: EFFORT_NOTE, scope: 'session' as const })
    if (eco.local && eco.localModel) {
      extra.push({ id: 'kokpit-local', text: localNote(eco.localModel, opencodeOk), scope: 'session' as const })
    }
    return { ...r, sections: [...r.sections, ...extra] }
  })

  // Safety net: if an auto-compact happens after all, the summary must not blur decisions and must point to
  // the thread file. We do not block it: with a full window the handoff might no longer fit.
  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    return next({ ...e, instructions: [e.instructions, COMPACT_NOTE].filter(Boolean).join('\n') })
  }).catch(($, e, next) => next(e))

  // A manual /clear after a stale handoff would lose what came after the save: refresh first.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    if (e.origin.kind === 'plugin') return next(e)
    const h = await read($, handoffAtom)
    if (h.savedPath && !h.stale && !h.running) await saveAnswers($, h.savedPath)
    if (!h.savedPath || !h.stale || h.running) return next(e)
    $.clock.after(0, () => refreshThenClear($))
    return {
      text:
        'Kokpit: the conversation moved on since the thread "' +
        threadName(h.savedPath) +
        '" was saved, so I am refreshing the handoff first and will clear afterwards. To clear without saving: "Stay here", then /clear.',
    }
  }).catch(($, e, next) => next(e))

  // /handoff typed by hand or called by Claude counts as "writing" too. In plan mode the thread cannot be
  // written: a note replaces the skill and the handoff comes back after plan mode ends.
  on('skill.prompt', async ($, e, next) => {
    const name = e.skill.replace(/^kokpit:/, '')
    if (name === 'handoff') {
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
      const r = await next(e)
      return { text: r.text + handoffLanguageNote(language) }
    }
    if (name === 'setup') {
      const r = await next(e)
      return { text: r.text + setupLanguageNote(language) }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A user message after the thread was saved: instead of the button, refresh (when needed), clear, resume and
  // send it in the new session. During a handoff it waits for the handoff to end.
  on('prompt.submit', async ($, e, next) => {
    // A note about a side session's handoff or resume: nothing new, and the model would comment on it.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge' && e.origin.kind !== 'plugin') {
      const quiet = housekeepingNote(e.text)
      if (quiet) return { drop: `Kokpit: skipped a note — "${quiet.join('", "')}" only saved a handoff or resumed a thread.` }
      return next(e)
    }
    await update($, resumableAtom, () => null)
    // The user's answer: background results held during the question go with it (the model reads them).
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && !e.command) {
      const held = await takeInbox($)
      if (held.length > 0) e = { ...e, context: [...(e.context ?? []), inboxText(held)] }
    }
    if (clearMode !== 'message' || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)
    // Commands, messages with images and hidden ones stay in this conversation (an image cannot be carried over).
    if (e.command || e.isMeta || (e.attachments && e.attachments.length > 0)) return next(e)
    const h = await read($, handoffAtom)
    if (h.planMode) return next(e)
    if (h.running) {
      await holdPrompt($, [e.text, ...(e.context ?? [])].join('\n\n'))
      await update($, handoffAtom, x => ({ ...x, clearAfter: true }))
      return heldNotice($, 'finishing the handoff, then I clear the conversation, resume the thread and send it in the new session.', LONG_TOAST_MS)
    }
    // Without a saved thread there is nothing to resume; during another turn /clear would interrupt it.
    if (!h.savedPath || e.turnId) return next(e)
    // Background work would deliver its result to a conversation that no longer exists: the message stays here.
    if ((await backgroundWork($)).length > 0) return next(e)
    const path = h.savedPath
    await holdPrompt($, [e.text, ...(e.context ?? [])].join('\n\n'))
    if (h.stale) {
      $.clock.after(0, () => refreshThenClear($, 'refresh'))
      return heldNotice($, `refreshing the thread "${threadName(path)}", then clearing the conversation and sending it in the new session.`, LONG_TOAST_MS)
    }
    $.clock.after(0, () => clearAndResume($, path))
    return heldNotice($, `clearing the conversation and resuming the thread "${threadName(path)}"; the message goes out in the new session.`)
  }).catch(($, e, next) => next(e))

  // Plan mode of the main loop: the reminder comes with every request, the exit once.
  on('prompt.attachment', { type: ['plan_mode', 'plan_mode_reentry', 'plan_mode_exit'] }, async ($, e, next) => {
    if (!e.agentId) {
      const planMode = e.type !== 'plan_mode_exit'
      if ((await read($, handoffAtom)).planMode !== planMode) await update($, handoffAtom, h => ({ ...h, planMode }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── Economy ──

  // The rating tool must be listed right away, not behind ToolSearch, or the rating would cost an extra step.
  on('tool.describe', { tool: 'mcp__kokpit__effort_rating' }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false })).catch(
    ($, e, next) => next(e),
  )

  on('tool.describe', { tool: 'mcp__kokpit__local_model' }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false })).catch(
    ($, e, next) => next(e),
  )

  on('tool.call', { tool: 'mcp__kokpit__local_model' }, async ($, e) => {
    const input = e as unknown as { mode?: unknown; task?: unknown; label?: unknown }
    const eco = (await read($, economyAtom)).active
    if (!eco.local || !eco.localModel) return { result: 'The local model is off (/kokpit → Economy).' }
    const localMode = input.mode === 'code' ? 'code' : 'text'
    const task = typeof input.task === 'string' ? input.task.trim() : ''
    if (!task) return { result: 'Empty brief.' }
    if (localMode === 'code' && !opencodeOk) return { result: 'Mode "code" is unavailable: no opencode on this machine. Use mode "text" or do it yourself.' }
    try {
      const root = (await $.session.root()).replace(/\/+$/, '')
      const id = new Date(await $.clock.now()).toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + localMode
      const dir = `${root}/${LOCAL_DIR}`
      await $.process.run(['mkdir', '-p', dir])
      const promptFile = `${dir}/${id}.prompt.md`
      await $.fs.write(promptFile, task)
      const cmd = localMode === 'code' ? localCodeCmd(root, id, eco.localModel, promptFile) : localTextCmd(eco.localModel, promptFile)
      const label = ((typeof input.label === 'string' && input.label.trim()) || `${eco.localModel}: ${localMode}`).slice(0, 40)
      const job = await startJob($, 'local', label, shellArgv(cmd), true)
      economyTurn = mergeStats(economyTurn, { ...emptyStats(''), subagents: { [`local/${localMode}`]: 1 } })
      return { result: `Handed to ${eco.localModel} (${job}). Keep working; the result comes as a message from Kokpit.` }
    } catch (err) {
      return { result: 'Not handed over: ' + String(err instanceof Error ? err.message : err) }
    }
  })

  on('tool.call', { tool: 'mcp__kokpit__effort_rating' }, async ($, e) => {
    const input = e as unknown as { rating?: unknown; reason?: unknown }
    if (!isRating(input.rating)) return { result: `Unknown rating; use one of: ${RATINGS.join(', ')}.` }
    const rating = input.rating
    const reason = typeof input.reason === 'string' ? input.reason.slice(0, 120) : ''
    const eco = await read($, economyAtom)
    // A repeated rating in the same turn corrects up or down; tool failures are counted afresh.
    await update($, economyAtom, x => ({ ...x, rating, reason, bumps: 0 }))
    economyTurn = mergeStats(economyTurn, { ...emptyStats(''), ratings: { [rating]: 1 } })
    const ceiling = eco.ceiling
    const nextLevel = ceiling ? levelFor(rating, 0, eco.active.floor, ceiling) : null
    return {
      result:
        nextLevel && ceiling
          ? `Noted: ${rating}. From the next step effort is ${nextLevel} (session ceiling: ${ceiling}).`
          : `Noted: ${rating}.`,
    }
  })

  // A failed tool call in the main conversation: something went wrong, the next steps go one level higher (up to the ceiling).
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!('isError' in r) || !r.isError) return r
    if (e.agentId) {
      // A failure in a subagent: its next steps go one level higher (turn.step).
      agentErrors.set(e.agentId, (agentErrors.get(e.agentId) ?? 0) + 1)
      return r
    }
    const eco = await read($, economyAtom)
    if (eco.active.effort && eco.rating !== null) await update($, economyAtom, x => ({ ...x, bumps: x.bumps + 1 }))
    return r
  }).catch(($, e, next) => next(e))

  // Every main-conversation request: effort from the rating. Only on models where the change keeps the cache.
  on('turn.step', async function* ($, e, next) {
    const eco = await read($, economyAtom)
    let send = e
    let ceiling: Level | null = null
    let want: Level | null = null
    if (e.agentId && eco.active.split && isLevel(e.effort) && effortCacheSafe(e.model)) {
      const errors = agentErrors.get(e.agentId) ?? 0
      const level = errors > 0 ? subagentStepLevel(e.effort, errors) : e.effort
      if (level !== e.effort) send = { ...e, effort: level }
    }
    if (!e.agentId) {
      lastMainModel = e.model
      if (isLevel(e.effort)) lastMainEffort = e.effort
      if (eco.active.effort && isLevel(e.effort) && effortCacheSafe(e.model)) {
        // The ceiling from the settings (xhigh by default), or the session level.
        ceiling = eco.active.ceiling === 'session' ? e.effort : eco.active.ceiling
        // In plan mode thinking is the whole job: stay at the ceiling.
        const plan = (await read($, handoffAtom)).planMode
        want = plan ? ceiling : levelFor(eco.rating, eco.bumps, eco.active.floor, ceiling)
        if (eco.ceiling !== ceiling || eco.current !== want) await update($, economyAtom, x => ({ ...x, ceiling, current: want }))
        if (want !== e.effort) send = { ...e, effort: want }
      }
    }
    const r = yield* next(send)
    // Accounting must never break a request: everything below is best effort.
    try {
      const usage = (r as { usage?: StepUsage | null } | undefined)?.usage ?? null
      const main = !e.agentId
      accruedCost += stepCost(usage, e.model, main)
      if (usage && !knownModel(e.model)) economyTurn = { ...economyTurn, unknownModels: economyTurn.unknownModels + 1 }
      const out = usage?.output_tokens ?? 0
      if (main && ceiling && want) {
        const cur = economyTurn.steps[want] ?? { n: 0, out: 0 }
        const saved = savedOutput(out, want, ceiling)
        const lowered = rank(want) < rank(ceiling)
        const key = `${e.model}|${ceiling}>${want}`
        economyTurn = {
          ...economyTurn,
          steps: { ...economyTurn.steps, [want]: { n: cur.n + 1, out: cur.out + out } },
          lowered: economyTurn.lowered + (lowered ? 1 : 0),
          savedOutput: economyTurn.savedOutput + saved,
          lowerings: lowered ? { ...economyTurn.lowerings, [key]: (economyTurn.lowerings[key] ?? 0) + out } : economyTurn.lowerings,
          savedEffortUsd: economyTurn.savedEffortUsd + (saved * priceFor(e.model).out) / 1e6,
        }
      } else if (!main && eco.active.split && usage) {
        // Without Economy: the conversation's model (Explore: Haiku) and effort; same tokens, output rescaled.
        const type = agentTypes.get(e.agentId ?? '') ?? ''
        const baseModel = type === 'Explore' ? 'haiku' : lastMainModel || e.model
        const subEffort: Level = isLevel(e.effort) ? e.effort : 'high'
        const baseEffort: Level = lastMainEffort ?? subEffort
        const scale = EFFORT_FACTOR[baseEffort] / EFFORT_FACTOR[subEffort]
        economyTurn = {
          ...economyTurn,
          subCost: economyTurn.subCost + stepCost(usage, e.model, false),
          subBaseline: economyTurn.subBaseline + stepCost(usage, baseModel, false, scale),
        }
      }
    } catch {
      // no stats for this step
    }
    return r
  })

  // Subagent: Haiku only in its roles; no effort given = the role's default instead of inheriting e.g. xhigh.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.agentId || e.tool !== 'Agent' || !(await read($, economyAtom)).active.split) return next(e)
    const type = e.subagent_type ?? 'general-purpose'
    const model = subagentModel(e.model, type)
    const effort = subagentEffort(e.effort, type) as Level
    const key = `${model ?? (HAIKU_TYPES.includes(type) ? 'haiku' : 'inherited')}/${effort}`
    economyTurn = mergeStats(economyTurn, { ...emptyStats(''), subagents: { [key]: 1 } })
    if (model === e.model && effort === e.effort) return next(e)
    return next({ ...e, ...(model ? { model: model as 'sonnet' | 'opus' | 'haiku' | 'fable' } : {}), effort })
  }).catch(($, e, next) => next(e))

  // The same when a subagent starts (Haiku outside its roles → Sonnet).
  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.workflow || !(await read($, economyAtom)).active.split) return next(e)
    const model = subagentModel(e.model, e.subagentType)
    const r = await next(model === e.model ? e : { ...e, model })
    if ('agentId' in r && r.agentId) {
      agentTypes.set(r.agentId, e.subagentType)
      if (agentTypes.size > 200) agentTypes.delete(agentTypes.keys().next().value ?? '')
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== KOKPIT_PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const tab = await read($, tabAtom)
    const root = await $.session.root()
    const narrow = e.props.bodyColumns < 90
    const L = narrow ? 14 : 22

    // A "label — value" row with a fixed-width column (aligns in the terminal and in the app).
    const row = (key: string, label: string, value: string, color?: string) => (
      <Box key={key} flexDirection="row">
        <Box width={L}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text color={color} wrap="wrap">
          {value}
        </Text>
      </Box>
    )
    const choice = <T extends string>(prefix: string, opts: { id: T; label: string }[], current: T, pick: (v: T) => unknown) => (
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {opts.map(o =>
          o.id === current ? (
            <Button key={prefix + o.id} label={'● ' + o.label} onPress={() => pick(o.id)} />
          ) : (
            <Button key={prefix + o.id} label={o.label} plain onPress={() => pick(o.id)} />
          ),
        )}
      </Box>
    )

    const header = (
      <Box flexDirection="column">
        {choice('tab-', TABS, tab, t => update($, tabAtom, () => t))}
        <Text dimColor>{`${root} · Tab moves between buttons, Esc closes`}</Text>
        <Text> </Text>
      </Box>
    )

    if (tab === 'economy') {
      const eco = await read($, economyAtom)
      const local = await read($, localAtom)
      const s = eco.saved
      const differs = (Object.keys(s) as (keyof EconomySettings)[]).some(key => s[key] !== eco.active[key])
      const toggle = (key: string, title: string, enabled: boolean, flip: () => unknown) => (
        <Box flexDirection="row" columnGap={2}>
          <Box width={L + 6}>
            <Text bold>{title}</Text>
          </Box>
          <Text color={enabled ? 'green' : undefined}>{enabled ? '● on' : '○ off'}</Text>
          <Button key={key} label={enabled ? 'Turn off' : 'Turn on'} onPress={flip} />
        </Box>
      )
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>Settings of this project (shared by its worktrees).</Text>
          <Text> </Text>
          {toggle('eco-split', 'Split across subagents', s.split, () => saveEconomy($, x => ({ ...x, split: !x.split })))}
          <Text dimColor wrap="wrap">
            Claude splits a large task into subtasks and picks Opus or Sonnet and an effort level for each subagent from
            a rubric. Haiku only in three roles: Explore (searches), kokpit:reporter (reports test output verbatim),
            kokpit:mechanic (pattern-driven change with a check; stops instead of guessing). A failed tool call in a
            subagent raises its effort.
          </Text>
          <Text> </Text>
          {toggle('eco-effort', 'Dynamic effort', s.effort, () => saveEconomy($, x => ({ ...x, effort: !x.effort })))}
          <Text dimColor wrap="wrap">
            For every request Claude rates the difficulty: simple → the lowest level, medium → high, hard → the highest.
            A failed tool call raises it one level; plan mode stays at the highest. Only 5.5 models and Fable 5.1 (no
            cache loss).
          </Text>
          <Box flexDirection="row">
            <Box width={L + 6}>
              <Text dimColor>Lowest level</Text>
            </Box>
            {choice('eco-floor-', (['low', 'medium', 'high'] as Level[]).map(l => ({ id: l, label: l })), s.floor, l =>
              saveEconomy($, x => ({ ...x, floor: l })),
            )}
          </Box>
          <Box flexDirection="row">
            <Box width={L + 6}>
              <Text dimColor>Highest level</Text>
            </Box>
            {choice(
              'eco-ceiling-',
              [
                { id: 'session' as Level | 'session', label: 'as in session' },
                ...(['high', 'xhigh', 'max'] as Level[]).map(l => ({ id: l as Level | 'session', label: l })),
              ],
              s.ceiling,
              l => saveEconomy($, x => ({ ...x, ceiling: l })),
            )}
          </Box>
          <Text> </Text>
          {toggle('eco-local', 'Local model (Ollama)', s.local, () => saveEconomy($, x => ({ ...x, local: !x.local })))}
          <Text dimColor wrap="wrap">
            {local === null
              ? 'Checking Ollama…'
              : !local.ollama
                ? 'Ollama does not respond (`ollama list`): start it, then "Refresh list".'
                : `Text directly through Ollama, code through opencode in a separate worktree (a diff to review). opencode: ${local.opencode ? 'found' : 'missing, text only'}.`}
          </Text>
          <Box flexDirection="row" flexWrap="wrap">
            <Box width={L + 6}>
              <Text dimColor>{`Model: ${s.localModel || '—'}`}</Text>
            </Box>
            {local && local.models.length
              ? choice('eco-model-', local.models.map(m => ({ id: m, label: m })), s.localModel, m =>
                  saveEconomy($, x => ({ ...x, localModel: m })),
                )
              : ''}
            <Button key="eco-local-refresh" label="Refresh list" plain onPress={() => refreshLocal($)} />
          </Box>
          {s.local && !s.localModel ? <Text color="yellow">Pick a model: the local model does nothing without one.</Text> : ''}
          <Text> </Text>
          {differs ? (
            <Text color="yellow" wrap="wrap">
              Changes take effect in a new conversation or after /clear (mid-conversation they would change the prompt
              and burn the cache).
            </Text>
          ) : (
            <Text dimColor>This conversation runs with the settings above.</Text>
          )}
        </Box>
      )
    }

    if (tab === 'stats') {
      const st = await read($, economyStatsAtom)
      const cal = await read($, calibrationAtom)
      const plan = cal?.plan ?? 'x20'
      const planName = PLAN_NAME[plan]
      const v = st && cal ? statsView(st, cal.calibration) : null
      const planRow = (
        <Box flexDirection="row">
          <Box width={L}>
            <Text dimColor>Your plan</Text>
          </Box>
          {choice(
            'eco-plan-',
            (['pro', 'x5', 'x20'] as Plan[]).map(p => ({ id: p, label: PLAN_NAME[p] })),
            plan,
            p => setPlan($, p),
          )}
        </Box>
      )
      if (!v || (v.steps === 0 && !v.subagents.length)) {
        return (
          <Box flexDirection="column">
            {header}
            {planRow}
            <Text> </Text>
            <Text dimColor>Nothing yet: stats are collected while Economy is on.</Text>
          </Box>
        )
      }
      const sign = (n: number) => (n >= 0 ? 'green' : 'red')
      return (
        <Box flexDirection="column">
          {header}
          {planRow}
          {row('st-period', 'Period', `since ${v.since.slice(0, 10)} · ${v.steps.toLocaleString('en-US')} main-conversation steps`)}
          <Text> </Text>
          <Text bold>{`Savings on ${planName} (estimate)`}</Text>
          {v.week
            ? row('st-week', 'Week', `${range(v.week.percent, pct)} of the weekly limit`, v.total.hi >= 0 ? 'green' : 'red')
            : row('st-week', 'Week', `after calibration: ${pct(v.measured)} of the week measured, 3% needed`)}
          {row('st-total', 'Total', `${range(v.total, usd)} at API prices`, sign(v.total.lo))}
          {row(
            'st-effort',
            'Dynamic effort',
            v.lowered
              ? `${range(v.effort.tokens, compact)} fewer output tokens · ${range(v.effort.usd, usd)} · ${v.lowered} of ${v.steps} steps lower`
              : 'none: no step went below the highest level',
          )}
          {row(
            'st-sub',
            'Subagents',
            v.sub
              ? `${usd(v.sub.usd)} (${v.sub.pct >= 0 ? '−' : '+'}${Math.abs(Math.round(v.sub.pct))}% cost versus the same tasks on the conversation's model)`
              : 'no data',
            v.sub ? sign(v.sub.usd) : undefined,
          )}
          <Text> </Text>
          <Text bold>Steps by effort</Text>
          <Box flexDirection="row">
            <Box width={L}>
              <Text dimColor>level</Text>
            </Box>
            <Box width={12}>
              <Text dimColor>steps</Text>
            </Box>
            <Text dimColor>avg output tokens</Text>
          </Box>
          {v.levels.map(p => (
            <Box key={'st-lv-' + p.level} flexDirection="row">
              <Box width={L}>
                <Text>{p.level}</Text>
              </Box>
              <Box width={12}>
                <Text>{p.steps.toLocaleString('en-US')}</Text>
              </Box>
              <Text>{p.avgOut.toLocaleString('en-US')}</Text>
            </Box>
          ))}
          {row('st-ratings', 'Difficulty ratings', `simple ${v.ratings.simple} · medium ${v.ratings.medium} · hard ${v.ratings.hard}`)}
          {v.subagents.length ? row('st-subl', 'Subagents (model/effort)', v.subagents.map(x => `${x.key} ${x.n}`).join(' · ')) : ''}
          {v.week
            ? row(
                'st-cal',
                'Calibration',
                `${planName} week ≈ ${usd(v.week.usd)} at API prices · ${v.week.samples} samples over ${pct(v.week.measured)} of the week`,
              )
            : ''}
          {v.unknownModels ? row('st-unk', 'Note', `${v.unknownModels} steps on models missing from the price list (priced as Opus 5.5)`, 'yellow') : ''}
          <Text> </Text>
          <Text dimColor wrap="wrap">
            How this is computed: tokens and their kind (input, cache, output) are measured for every request and priced
            with the API price list. Two things are estimates. Effort: how much more thinking a step at the highest level
            would have produced, hence the ranges (high 1.2–1.6×, xhigh 1.5–2.5×, max 1.8–3.2× of medium output).
            Subagents: the same tokens on the conversation's model and effort (Explore against Haiku). Share of the week:
            the measured cost of all requests against the rise of the weekly counter on the selected plan; usage from
            other devices and chats in the meantime inflates it.
          </Text>
          <Box flexDirection="row" columnGap={2}>
            <Button
              key="eco-reset"
              label="Reset stats"
              plain
              onPress={async () => {
                const fresh = emptyStats(new Date(await $.clock.now()).toISOString())
                await $.store.set(await statsKey($), fresh)
                await update($, economyStatsAtom, () => fresh)
              }}
            />
          </Box>
        </Box>
      )
    }

    // Handoff and tools
    const usage = await read($, usageAtom)
    const log = ((await $.store.get('log')) as HandoffLogEntry[] | undefined) ?? []
    const win = usage?.contextWindow ?? 200_000
    const threshold = thresholdFor(tokensSetting, win)
    const decisions = await read($, decisionsAtom)
    return (
      <Box flexDirection="column">
        {header}
        <Text bold>Handoff</Text>
        {row('h-mode', 'Mode', mode === 'auto' ? 'auto: by itself after the threshold' : mode === 'break' ? 'break: by itself after a finished task' : 'button')}
        {row('h-thr', 'Thresholds', `soft ${k(threshold)}, hard ${k(hardThresholdFor(threshold, hardSetting, win))} tokens`)}
        {row('h-clear', 'Clearing', clearMode === 'message' ? 'on your next message' : 'with the button')}
        {row('h-lang', 'Language', language === 'pl' ? 'Polish (new threads, register, templates)' : 'English (new threads, register, templates)')}
        {row('h-stats', 'Stats', stats(log, await $.clock.now()))}
        <Text dimColor wrap="wrap">To change these: /plugin configure kokpit@kokpit in a terminal (or /config → Kokpit).</Text>
        <Text> </Text>
        <Text bold>Tools</Text>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          <Button
            key="h-decisions"
            label={`Decision register${decisions ? ` (${decisions.pending} pending)` : ''}`}
            onPress={() => $.ui.open({ id: DECISIONS_PANE, title: 'Decisions', focus: true, closeOnEscape: true })}
          />
          <Button
            key="h-tools"
            label="Tools in this repo"
            onPress={async () => {
              await refreshTools($)
              await $.ui.open({ id: TOOLS_PANE, title: 'Tools in this repo', focus: true, closeOnEscape: true })
            }}
          />
          <Button
            key="h-previous"
            label="Previous answers"
            plain
            onPress={() => $.ui.open({ id: PREVIOUS_PANE, title: 'Previous answers', focus: true, closeOnEscape: true })}
          />
        </Box>
      </Box>
    )
  })

  // The engine reports commands and other background tasks only on Stop: remember them for /clear decisions.
  on('classic.Stop', async ($, e, next) => {
    lastBackground = (e.background_tasks ?? []).map(t => ({ type: t.type, description: t.description }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      askedThisTurn = false
      turnRunning = true
      // A new request: the first step goes at the session level; only the model's rating lowers it.
      const eco = await read($, economyAtom)
      if (eco.active.effort && (eco.rating !== null || eco.bumps > 0)) {
        await update($, economyAtom, x => ({ ...x, rating: null, reason: '', bumps: 0 }))
      }
    }
    currentTurnId = e.turnId
    return next(e)
  })

  // End of a turn: this is where the automatic handoff is decided.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    turnRunning = false
    await flushEconomyStats($).catch(() => {})
    // The turn in which a handoff was written always closes it, also when aborted or without a save.
    const wasRunning = (await read($, handoffAtom)).running
    if (wasRunning) await finishHandoff($, e.isAborted)
    else if (!e.isAborted) {
      // Answers to keep on clearing (handoff turns excluded) and whether the turn ended with a question.
      const answer = (e.answer ?? '').trim()
      if (answer) {
        const at = new Date(await $.clock.now()).toISOString()
        await update($, answersAtom, a => [...a, { at, text: answer }].slice(-ANSWERS_KEEP))
      }
      const awaiting = askedThisTurn || endsWithQuestion(answer)
      if ((await read($, handoffAtom)).awaiting !== awaiting) await update($, handoffAtom, x => ({ ...x, awaiting }))
    }
    // This turn's background results: after a question (or a handoff) they wait for the user, otherwise go to Claude.
    await releaseAfterTurn($, wasRunning || (await read($, handoffAtom)).awaiting)
    const h = await read($, handoffAtom)
    if (h.savedPath && e.turnId === h.savedTurnId) {
      // This turn saved the thread. A successful refresh before /clear → clear and resume, outside this event.
      if (h.clearAfter) {
        const path = h.savedPath
        $.clock.after(0, () => clearAndResume($, path))
      }
      return r
    }
    if (wasRunning) return r
    if (h.savedPath && !h.stale) await update($, handoffAtom, x => ({ ...x, stale: true }))
    // In plan mode nothing is written; the handoff and /clear wait.
    if (h.planMode) return r
    // "Clear and resume" was waiting for background work: once done, its results are in the conversation, so refresh and clear.
    if (h.clearWhenIdle) {
      if (h.savedPath && (await backgroundWork($)).length === 0) {
        await update($, handoffAtom, x => ({ ...x, clearWhenIdle: false }))
        $.clock.after(0, () => refreshThenClear($))
      }
      return r
    }
    if (e.isAborted) return r
    // A handoff requested in plan mode starts at the end of the first turn after it.
    if (h.afterPlan) {
      await update($, handoffAtom, x => ({ ...x, afterPlan: false }))
      $.clock.after(0, () => startHandoff($, 'button'))
      return r
    }
    if (mode === 'button') return r
    const usage = await read($, usageAtom)
    if (!usage) return r
    const soft = thresholdFor(tokensSetting, usage.contextWindow)
    const hard = hardThresholdFor(soft, hardSetting, usage.contextWindow)
    const now = await read($, handoffAtom)
    // Finished = nothing waits for the user's answer, and in "break" mode the whole list is also checked off.
    const finished = !now.awaiting && (mode === 'auto' || isFinished(await read($, tasksAtom)))
    if (!autoDue(usage.contextTokens, soft, hard, now, finished)) return r
    // Outside the current event: the turn has to close first.
    $.clock.after(0, () => startHandoff($, mode))
    return r
  })

  // ── Task list: TaskCreate / TaskUpdate (current tools) and TodoWrite (older) ──
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
      await update($, tasksAtom, ts => setStatus(ts, String(e.taskId), e.status, e.subject))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.isError && e.tool === 'TodoWrite') {
      const tasks: Task[] = e.todos.map((t, i) => ({ id: 'todo-' + i, subject: t.content, status: t.status }))
      await update($, tasksAtom, () => tasks)
    }
    return r
  }).catch(($, e, next) => next(e))

  // The desktop app's task list: the model keeps it with the app's tool, not TaskCreate.
  // Without this Kokpit saw an empty list and took every turn end for a break.
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.isError) await update($, tasksAtom, ts => applyPlan(ts, e as unknown as PlanCall))
    return r
  }).catch(($, e, next) => next(e))

  // `wrap_up` checks the list off; with a question (`ask`) the turn waits for the user's decision.
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.isError) {
      const ask = (e as unknown as { ask?: unknown }).ask
      if (typeof ask === 'string' && ask.trim()) askedThisTurn = true
      await update($, tasksAtom, ts => ts.map(t => ({ ...t, status: 'completed' as const })))
    }
    return r
  }).catch(($, e, next) => next(e))

  // Writing a thread needs no permission prompt: only a .md file directly in <project>/.claude/handoffs/.
  on('tool.check', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const path = (e.input as { file_path?: unknown } | null)?.file_path
    if (typeof path === 'string' && isHandoffPath(path, await $.session.root())) return { decision: 'allow' }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── Writing the thread file during a handoff = the handoff is done ──
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const r = await next(e)
    if (r.isError || (e.tool !== 'Write' && e.tool !== 'Edit')) return r
    const path = e.file_path.startsWith('/') ? e.file_path : (await $.session.cwd()).replace(/\/+$/, '') + '/' + e.file_path
    if (path.endsWith('/' + decisionsFile) || path === decisionsFile) await refreshDecisions($, decisionsFile)
    if (path.includes('/' + HANDOFF_DIR + '/') && !path.includes('/.previous/') && !path.includes('/.poprzednie/') && isThreadFile(path)) {
      // Edits of a thread outside a handoff (e.g. a manual fix) do not pose as a finished handoff.
      if ((await read($, handoffAtom)).running) await noteSaved($, path)
    }
    return r
  }).catch(($, e, next) => next(e))

  // ── "Previous answers" pane: the file saved before an automatic clear ──
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PREVIOUS_PANE) return next(e)
    const { Text, Markdown } = $.ui.resolve(e)
    const file = await read($, previousAtom)
    let text = ''
    try {
      text = file ? await $.fs.read(file) : ''
    } catch {
      // the file was removed: show that there is nothing
    }
    return text ? <Markdown text={text} /> : <Text dimColor>No saved answers from before a clear.</Text>
  })

  // ── Tools in this repo ──
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== TOOLS_PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, toolsAtom)
    if (!t) return <Text dimColor>Checking the tools in this repo…</Text>
    const cwd = await $.session.root()
    const setup = setupScript($, 'setup.sh')
    const share = t.share === null ? '?' : `${Math.round(t.share * 100)}%`
    const run = async (label: string, command: string) => {
      await startJob($, 'command', label, shellArgv(command), false)
      $.ui.toast(`${label}: running in the background, progress in the band; then "Refresh".`)
    }

    const graph = t.graphOn
      ? 'on in this repo (hooks in .claude/settings.json; after code changes `graphify update .` refreshes the graph)'
      : t.fits
        ? `fits: ${share} of the code is in languages it reads, worth turning on`
        : `does not fit: the graph would hold ${share} of the code (threshold 60%), hooks would send Claude to an incomplete graph`
    const graphButton = !t.graphifyInstalled ? (
      <Button
        key="tools-graphify-install"
        label="Install graphify on this machine"
        onPress={() => run('graphify: install', `"${setup}" machine --graphify`)}
      />
    ) : t.graphOn ? (
      <Button
        key="tools-graphify-off"
        label="Turn off in this repo"
        onPress={() => run('graphify: turning off', `cd "${cwd}" && graphify claude uninstall`)}
      />
    ) : (
      <Button
        key="tools-graphify-on"
        label={t.fits ? 'Turn on in this repo' : 'Turn on anyway'}
        onPress={() => run('graphify: turning on', `"${setup}" project "${cwd}" --graphify` + (t.fits ? '' : ' --force'))}
      />
    )

    const names = [...t.hidden, ...t.skills.map(x => x.name).filter(n => !t.hidden.includes(n))]
    const describe = (n: string) => t.skills.find(x => x.name === n)?.description ?? ''
    const skillRows = names.map(n => {
      const isHidden = t.hidden.includes(n)
      return (
        <Box key={'skill-row-' + n} flexDirection="row" columnGap={2}>
          <Button key={'skill-' + n} label={isHidden ? 'Show' : 'Hide'} plain onPress={() => setSkillHidden($, n, !isHidden)} />
          <Text color={isHidden ? 'yellow' : undefined}>{(isHidden ? '◌ ' : '● ') + n}</Text>
          <Text dimColor wrap="truncate-end">{describe(n)}</Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        <Text dimColor>{`${cwd} · Tab moves between buttons, Esc closes`}</Text>
        <Text> </Text>
        <Text bold>Code graph (graphify)</Text>
        <Text wrap="wrap">{(t.graphifyInstalled ? '' : 'not installed on this machine · ') + graph}</Text>
        <Box flexDirection="row" columnGap={2}>
          {graphButton}
          <Button key="tools-refresh" label="Refresh" plain onPress={() => refreshTools($)} />
        </Box>
        <Text> </Text>
        <Text bold>Skills visible to the model in this repo</Text>
        <Text dimColor wrap="wrap">
          A hidden skill (◌) takes no context and /name still works. Saved in .claude/settings.json, shared across
          machines once you commit it.
        </Text>
        {skillRows.length ? skillRows : <Text dimColor>No account skills and nothing in ~/.claude/skills.</Text>}
        <Text> </Text>
        <Text bold>headroom proxy</Text>
        <Text dimColor wrap="wrap">
          {`A terminal experiment only: ${setupScript($, 'claude-hr.sh')}. The app's Code tab bypasses it, and Remote Control turns off.`}
        </Text>
      </Box>
    )
  })

  // ── Decisions pane ──
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== DECISIONS_PANE) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // The text field exists in the terminal and the desktop app; elsewhere only the buttons remain.
    const Input = 'Input' in els ? els.Input : null
    const ds = await readDecisions($, decisionsFile)
    const open = pending(ds)
    const ready = toApply(ds)

    const rows = open.map(d => {
      const question = isQuestion(d)
      const body = d.fields.proposal ?? d.fields.question ?? ''
      const meta = [d.fields.area, d.fields.source].filter(Boolean).join(' · ')
      return (
        <Box key={'d-' + d.id} flexDirection="column" marginBottom={1}>
          <Text bold>{`${d.id} · ${d.title}` + (question ? '  (question)' : '')}</Text>
          {body ? <Text wrap="wrap">{body}</Text> : ''}
          {meta ? <Text dimColor wrap="truncate-end">{meta}</Text> : ''}
          <Box flexDirection="row" columnGap={2}>
            {question ? '' : <Button key={'ok-' + d.id} label="Accept" onPress={() => decide($, decisionsFile, d.id, 'accepted')} />}
            {question ? '' : <Button key={'no-' + d.id} label="Reject" onPress={() => decide($, decisionsFile, d.id, 'rejected')} />}
            {Input ? (
              <Input
                key={'in-' + d.id}
                label={question ? 'Answer' : 'Change'}
                placeholder={question ? 'type the answer and Enter' : 'your version and Enter'}
                value=""
                submitLabel="save"
                onSubmit={async (value: string) => {
                  if (!value.trim()) return
                  await decide($, decisionsFile, d.id, question ? 'accepted' : 'changed', value)
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
        <Text>{`Resolved, to carry into the documents: ${ready.length}`}</Text>
        <Button
          key="kokpit-apply"
          label="Apply to documents"
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
            ? `${open.length} pending · ${decisionsFile} · Tab moves between buttons, Esc closes`
            : `Nothing waits for a decision · ${decisionsFile}`}
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
    const hard = hardThresholdFor(threshold, hardSetting, usage.contextWindow)
    const previous = await read($, previousAtom)
    const p = progress(tasks)

    const sep = <Text dimColor>{'  ·  '}</Text>
    const meter = (label: string, value: number | null, extra: string) => (
      <Text>
        <Text dimColor>{label + ' '}</Text>
        {value === null ? <Text dimColor>—</Text> : <Text color={tone(value)}>{`${bar(value, cells)} ${Math.round(value)}%`}</Text>}
        {extra ? <Text dimColor>{' ' + extra}</Text> : ''}
      </Text>
    )

    const ctxExtra = narrow || tokens === null ? '' : `${k(tokens)}/${k(usage.contextWindow)}`
    const fiveReset = resetLabel(usage.fiveHourResetsAt, false)
    const weekReset = resetLabel(usage.weekResetsAt, true)

    const taskText = p ? (
      <Text>
        <Text dimColor>Task </Text>
        <Text color={p.percent === 100 ? 'green' : undefined}>{`${bar(p.percent, cells)} ${p.percent}%`}</Text>
        <Text dimColor>{` ${p.done}/${p.total}` + (p.current && !narrow ? ' — ' + p.current : '')}</Text>
      </Text>
    ) : (
      <Text dimColor>{narrow ? 'Task —' : 'Task — no list'}</Text>
    )

    const eco = await read($, economyAtom)
    const effortMeter =
      eco.active.effort && eco.ceiling ? (
        <Text>
          <Text dimColor>Effort </Text>
          {eco.current && eco.current !== eco.ceiling ? (
            <Text color="green">{`${eco.ceiling}→${eco.current}`}</Text>
          ) : (
            <Text>{eco.ceiling}</Text>
          )}
          {eco.rating && !narrow ? <Text dimColor>{` (${eco.rating})`}</Text> : ''}
        </Text>
      ) : null

    const openPane = (id: string, title: string) => $.ui.open({ id, title, focus: true, closeOnEscape: true })
    const meters = (
      <Box flexDirection="row" flexWrap="wrap">
        {meter(narrow ? 'Ctx' : 'Context', ctx, ctxExtra)}
        {sep}
        {meter('5h', usage.fiveHour, fiveReset && '→' + fiveReset)}
        {sep}
        {meter('Week', usage.week, weekReset && '→' + weekReset)}
        {sep}
        {taskText}
        {effortMeter ? sep : ''}
        {effortMeter}
        {decisions && (decisions.pending || decisions.toApply) ? sep : ''}
        {decisions && (decisions.pending || decisions.toApply) ? (
          <Button
            key="kokpit-decisions"
            label={`Decisions: ${decisions.pending} pending` + (decisions.toApply ? ` · ${decisions.toApply} to apply` : '')}
            hotkey="9"
            plain
            onPress={() => openPane(DECISIONS_PANE, 'Decisions')}
          />
        ) : (
          ''
        )}
        {previous ? sep : ''}
        {previous ? (
          <Button key="kokpit-previous" label="Previous answers" hotkey="8" plain onPress={() => openPane(PREVIOUS_PANE, 'Previous answers')} />
        ) : (
          ''
        )}
      </Box>
    )

    const inbox = await read($, inboxAtom)
    const inboxRows = inbox.map(x => (
      <Box key={'inbox-' + x.id} flexDirection="row" columnGap={2}>
        <Text color="cyan">{`📥 Result "${x.label}" is waiting for your answer; I will attach it to it`}</Text>
        <Button key={'send-' + x.id} label="Send now" plain onPress={() => sendInboxNow($, x.id)} />
      </Box>
    ))

    const jobRows = jobs.map(j => (
      <Box key={'job-' + j.id} flexDirection="row" columnGap={2}>
        <Text color={j.endedAt === null ? 'yellow' : j.code === 0 ? 'green' : 'red'}>{jobLine(j, now)}</Text>
        {j.endedAt === null ? <Button key={'stop-' + j.id} label="Stop" plain onPress={() => stopJob($, j.id)} /> : ''}
        {j.endedAt !== null && !j.byClaude ? (
          <Button
            key={'show-' + j.id}
            label="Show Claude"
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
          <Button key={'hide-' + j.id} label="Hide" plain onPress={() => setJob($, j.id, x => ({ ...x, hidden: true }))} />
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
            <Text color="yellow">
              {`⏳ Thread "${threadName(path)}" saved; I will clear after the background results` +
                (handoff.busy && handoff.busy.length > 0 ? ` (${handoff.busy.slice(0, 3).join(', ')})` : '')}
            </Text>
          ) : handoff.stale ? (
            <Text color="yellow">{`⚠ Thread "${threadName(path)}" saved earlier; the conversation moved on`}</Text>
          ) : (
            <Text color="green">
              {`✓ Thread "${threadName(path)}" saved` + (clearMode === 'message' ? '; your next message clears and resumes' : '')}
            </Text>
          )}
          <Button
            key="kokpit-clear-resume"
            label={handoff.stale ? 'Refresh, clear and resume' : 'Clear and resume'}
            hotkey="1"
            onPress={() => (handoff.stale ? refreshThenClear($) : clearAndResume($, path))}
          />
          {handoff.clearWhenIdle ? (
            <Button key="kokpit-force-clear" label="Clear anyway" plain onPress={() => clearAndResume($, path, true)} />
          ) : (
            ''
          )}
          <Button
            key="kokpit-stay"
            label="Stay here"
            plain
            onPress={() => update($, handoffAtom, h => ({ ...h, savedPath: null, clearWhenIdle: false, busy: undefined }))}
          />
        </Box>
      )
    } else if (handoff.running) {
      action = <Text color="yellow">{`… Writing the handoff to ${HANDOFF_DIR}/`}</Text>
    } else if (handoff.planMode && (handoff.afterPlan || isDue(tokens, threshold, handoff))) {
      action = <Text color={tone(ctx)}>{`⏸ Context ${k(tokens)}: handoff after plan mode ends.`}</Text>
    } else if (isDue(tokens, threshold, handoff)) {
      const when =
        tokens !== null && tokens >= hard
          ? 'after this turn (hard threshold)'
          : handoff.awaiting
            ? 'after your answer' + (mode === 'break' ? ' and a finished task' : '')
            : mode === 'auto'
              ? 'after this turn'
              : 'after the task is finished'
      const why =
        mode === 'button' || handoff.lastTokens > 0
          ? `⚑ Context ${k(tokens)}: a good moment for a handoff.`
          : `⚑ Context ${k(tokens)}: handoff ${when}.`
      action = (
        <Box flexDirection="row" columnGap={2}>
          <Text color={tone(ctx)}>{why}</Text>
          <Button
            key="kokpit-handoff"
            label={mode === 'button' || handoff.lastTokens > 0 ? 'Handoff' : 'Now'}
            hotkey="1"
            onPress={() => startHandoff($, 'button')}
          />
          <Button
            key="kokpit-snooze"
            label="Later"
            hotkey="2"
            onPress={() => update($, handoffAtom, h => ({ ...h, snoozedUntil: (tokens ?? 0) + STEP_TOKENS }))}
          />
        </Box>
      )
    } else if (resumable && !e.props.isWorking) {
      const path = resumable
      action = (
        <Box flexDirection="row" columnGap={2}>
          <Text dimColor>{`Latest thread: "${threadName(path)}"`}</Text>
          <Button
            key="kokpit-resume"
            label="Resume"
            hotkey="1"
            onPress={async () => {
              await update($, resumableAtom, () => null)
              await runSkill($, 'resume', threadName(path))
            }}
          />
          <Button key="kokpit-resume-no" label="No" plain onPress={() => update($, resumableAtom, () => null)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {meters}
        {jobRows}
        {inboxRows}
        {action}
      </Box>
    )
  })
}
