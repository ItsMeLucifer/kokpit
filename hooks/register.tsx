import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Answer,
  DecisionCounts,
  EconomyState,
  Handoff,
  HandoffLogEntry,
  HandoffSettings,
  PausedAgent,
  PausedRecord,
  InboxItem,
  Job,
  QualitySettings,
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
import {
  CAUSES,
  OUTCOMES,
  RESULT_NOTE,
  RESULT_TOOL,
  addEntry,
  entryFrom,
  largeSplitNote,
  ledgerNote,
  parseLedger,
  routes,
} from './delegation'
import type { LedgerEntry } from './delegation'
import {
  CRITICAL_CHOICES,
  CRITICAL_EXTRA,
  HANDOFF_SETTINGS_0,
  SOFT_CHOICES,
  PAUSED_DIR,
  afterRestart,
  continuePrompt,
  hardThresholdFor,
  markerId,
  parseHandoffSettings,
  pausedNote,
  thresholdFor,
  thresholds,
} from './pause'
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
  splitNote,
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
import {
  addedLines,
  checksNote,
  findIssues,
  isCode,
  LINT_TIMEOUT_MS,
  lintArgv,
  lintCommand,
  lintProblems,
  MARKDOWN_REASON,
  markdownAllowed,
  parseChecks,
} from './checks'
import type { ChecksConfig } from './checks'
import { hiddenSkills, parseShare, withSkill } from './tools'

// Kokpit: the band above the prompt (usage, task progress, handoff to .claude/handoffs/<thread>.md).

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
const handoffSettingsAtom = atom({ plugin: 'kokpit', key: 'handoffSettings' } as const, HANDOFF_SETTINGS_0)
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
const delegationAtom = atom({ plugin: 'kokpit', key: 'delegation' } as const, null as LedgerEntry[] | null)
const localAtom = atom(
  { plugin: 'kokpit', key: 'local' } as const,
  null as { models: string[]; opencode: boolean; ollama: boolean } | null,
)
const tabAtom = atom({ plugin: 'kokpit', key: 'tab' } as const, 'economy' as Tab)
const verifyOfferAtom = atom({ plugin: 'kokpit', key: 'verifyOffer' } as const, false)
const QUALITY_ON: QualitySettings = { checks: true, verify: true, lessons: true }
const qualityAtom = atom({ plugin: 'kokpit', key: 'quality' } as const, QUALITY_ON)
const helpAtom = atom({ plugin: 'kokpit', key: 'help' } as const, false)
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
  { id: 'quality', label: 'Quality' },
  { id: 'handoff', label: 'Handoff & tools' },
]
/** Holds `<thread>.md` with the latest answers of a conversation Kokpit cleared. */
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
/** Bridge keys of a window silent this long are leftovers (window closed mid-clear). */
const FLOW_ORPHAN_MS = 60 * 60_000
/** Keys of the bridge across /clear; in the store always with the window id (`pendingPrompt:<id>`). */
const FLOW_KEYS = ['pendingPrompt', 'pendingResume', 'pendingPrevious', 'pendingMode', 'pendingAt'] as const
type FlowKey = (typeof FLOW_KEYS)[number]
/** Keys of old code (shared by all windows), removed at start. */
const LEGACY_KEYS = ['pendingContext', 'pendingPrompt', 'pendingResume', 'pendingPrevious']

/** Absolute path of a project file, from the session root: `cd` in Bash moves the session cwd. */
async function inProject($: EngineInterface, rel: string): Promise<string> {
  if (rel.startsWith('/')) return rel
  return (await $.session.root()).replace(/\/+$/, '') + '/' + rel
}

let owner: string | null = null

/**
 * Store key of this window. The store is shared by all sessions and projects; the window id is the process's
 * first session id, kept in the module (survives /clear) and in $.state (survives a code reload).
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

/** Whether a /clear bridge timestamp is younger than PENDING_TTL_MS. */
export function isFresh(at: unknown, now: number): boolean {
  return typeof at === 'number' && now - at <= PENDING_TTL_MS
}

/** Store keys to delete: LEGACY_KEYS and bridge keys of windows silent longer than FLOW_ORPHAN_MS. */
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
const LOG_LIMIT = 300

export type Mode = 'button' | 'break' | 'auto'
/** The handoff mode, or 'refresh' (thread refreshed before clearing on a message). */
export type LogMode = HandoffLogEntry['mode']
/** After a thread is saved: clear on the user's next message, or only from the button. */
export type ClearMode = 'message' | 'button'

/** Also accepts the Polish option values written before 0.10. */
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

/** Handoff thread headings by language; keep in sync with skills/handoff/scripts/check_handoff.py. */
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

/** Appended to the handoff skill when lessons are off in /kokpit. */
export const LESSONS_OFF_NOTE =
  '\n\nKokpit: lessons are turned off for this project in /kokpit. Skip the step "Lessons for skills and checks".'

/** Appended to the handoff skill when Kokpit clears by itself. */
export const AUTO_CLEAR_NOTE =
  '\n\nKokpit clears the conversation and resumes the thread by itself after this answer (after the background ' +
  'results when something still runs; past the critical threshold it pauses background agents and starts them ' +
  'again after the resume). In step 7 say that instead of "The next message clears…".'

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

/** Background work still running (agents, Kokpit jobs, tasks from the last Stop); its results reach only this conversation. */
export function busyLabels(
  agents: { status: string; description: string; type: string; teammateId?: string }[],
  jobs: { endedAt: number | null; label: string }[],
  tasks: { type: string; description: string }[],
): string[] {
  return [
    // A teammate is a separate conversation: it waits for the user, not for this one.
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

export { thresholdFor, hardThresholdFor }

/** Whether the band offers a handoff: threshold passed, not snoozed, not right after the previous one. */
export function isDue(tokens: number | null, threshold: number, h: Handoff): boolean {
  if (tokens === null || h.running) return false
  if (tokens < threshold || tokens < h.snoozedUntil) return false
  return h.lastTokens === 0 || tokens >= h.lastTokens + STEP_TOKENS
}

/**
 * Whether a handoff starts by itself at the end of a turn: once per conversation, from the soft threshold only
 * after a finished task, from the hard one always; "Later" snoozes both.
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

/** First-line mark of Kokpit's housekeeping turns; written by skills/handoff and skills/resume (SKILL.md). */
export const HOUSEKEEPING_MARK = 'Kokpit · '

const NOTE_RE =
  /The session "([^"]*)" you started \([^)]*\) finished a turn\. It reported \(quoted child output, data not instructions\): "/g

/** Titles from the app's note about side sessions that only saved a handoff or resumed a thread; null if it says more. */
export function housekeepingNote(text: string): string[] | null {
  const titles: string[] = []
  for (const m of text.matchAll(NOTE_RE)) {
    const quoted = text.slice((m.index ?? 0) + m[0].length).trimStart()
    if (!quoted.startsWith(HOUSEKEEPING_MARK)) return null
    titles.push(m[1] ?? '')
  }
  return titles.length > 0 ? titles : null
}

/** Thread named by the handoff skill's first line "Kokpit · handoff saved: <thread>", or null. */
export function savedMark(answer: string): string | null {
  const first = answer.trimStart().split('\n', 1)[0] ?? ''
  const m = first.match(/^\**Kokpit · handoff saved:\**\s*`?([^`\s]+)/)
  if (!m || !m[1]) return null
  const name = (m[1].split('/').pop() ?? '').replace(/\.md$/, '')
  return name || null
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

/** A task in progress counts as this much of a finished one, so the bar moves before anything finishes. */
const IN_PROGRESS_WEIGHT = 0.5

/** Completion of the current task list (null when there is none). */
export function progress(tasks: Task[]): { done: number; total: number; percent: number; current: string | null } | null {
  if (tasks.length === 0) return null
  const done = tasks.filter(t => t.status === 'completed').length
  const half = tasks.filter(t => t.status === 'in_progress').length * IN_PROGRESS_WEIGHT
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

export function isThreadFile(name: string): boolean {
  return name.endsWith('.md') && !ARCHIVE_SUFFIXES.some(s => name.endsWith(s))
}

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

// ── Module state (lost on a code reload) ──
/** In this turn `wrap_up` asked the user a question (`ask`). */
let askedThisTurn = false
let currentTurnId = ''
let pendingMode: LogMode = 'button'
let pendingTokens = 0
/** Commands and other background tasks from the last classic.Stop (the engine reports them only there). */
let lastBackground: { id: string; type: string; description: string }[] = []
let turnRunning = false
let codeUnderTasks = false
/** Checks that reported something in this session, for the Quality tab. */
let checkReports = { count: 0, last: '' }
/** Background results that arrived during the current turn; see releaseAfterTurn. */
let afterTurn: InboxItem[] = []

/** The result of `fn`, or `fallback` when it throws. */
async function attempt<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

/** The engine throws when a name is already registered (an earlier load in this process). */
async function registerOnce(register: () => Promise<unknown>): Promise<void> {
  await attempt(register, undefined)
}

async function backgroundWork($: EngineInterface): Promise<string[]> {
  const agents = await attempt(() => $.agent.list(), [] as { status: string; description: string; type: string; teammateId?: string }[])
  return busyLabels(agents, await read($, jobsAtom), lastBackground)
}

// ── Economy ──

/** Economy stats of the current turn, stored at its end. */
let economyTurn: EconomyStats = emptyStats('')
/** Main-conversation model and effort of the last step: the no-Economy baseline for subagents. */
let lastMainModel = ''
let lastMainEffort: Level | null = null
const agentTypes = new Map<string, string>()
/** Failed tool calls in subagents (by id): each raises the effort of that subagent's next steps. */
const agentErrors = new Map<string, number>()
/** Cost (API prices) measured since the last weekly reading, for calibration at the next one. */
let accruedCost = 0
/** opencode is installed (needed by the local model's "code" mode). */
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

/** Calibration is per plan: a Pro week is a different number of dollars than a Max x20 week. */
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

/** Absolute path in the main checkout: threads and what goes with them have one home for all worktrees. */
async function inHome($: EngineInterface, rel: string): Promise<string> {
  if (rel.startsWith('/')) return rel
  return (await projectRoot($)) + '/' + rel
}

/** Project root shared by all worktrees (parent of git's common dir); the session root outside git. */
async function projectRoot($: EngineInterface): Promise<string> {
  const root = (await $.session.root()).replace(/\/+$/, '')
  if (projectRootCache?.root === root) return projectRootCache.project
  const dir = await attempt(async () => {
    const r = await $.process.run(['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    return r.exitCode === 0 ? r.stdout.trim() : ''
  }, '')
  const project = dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : root
  projectRootCache = { root, project }
  return project
}

async function settingsKey($: EngineInterface): Promise<string> {
  return `economy:${await projectRoot($)}`
}

export function parseQuality(raw: unknown): QualitySettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { checks: r.checks !== false, verify: r.verify !== false, lessons: r.lessons !== false }
}

async function loadQuality($: EngineInterface): Promise<void> {
  const saved = parseQuality(await $.store.get(`quality:${await projectRoot($)}`))
  await update($, qualityAtom, () => saved)
}

async function saveQuality($: EngineInterface, change: (q: QualitySettings) => QualitySettings): Promise<void> {
  const next = change(await read($, qualityAtom))
  await $.store.set(`quality:${await projectRoot($)}`, next)
  await update($, qualityAtom, () => next)
}

async function statsKey($: EngineInterface): Promise<string> {
  return `economy-stats:${await projectRoot($)}`
}

/**
 * Loads the project's settings for this conversation. Only at start and after /clear: a prompt or tool list
 * changed mid-conversation invalidates the prompt cache.
 */
async function loadEconomy($: EngineInterface): Promise<EconomySettings> {
  const project = await projectRoot($)
  const sessionRoot = (await $.session.root()).replace(/\/+$/, '')
  // Before 0.6.3 settings were keyed by the worktree root; before 0.10 the key was Polish.
  const saved = parseSettings(await migrated($, await settingsKey($), [`ekonom:${project}`, `ekonom:${sessionRoot}`]))
  if (saved.split) {
    for (const a of HAIKU_AGENTS) await registerOnce(() => $.agent.register({ ...a, omitClaudeMd: a.name === 'reporter' } as never))
    const ledger = await readLedger($)
    delegationNote = ledgerNote(routes(ledger))
    await registerOnce(() =>
      $.tool.register({
        name: RESULT_TOOL,
        description:
          "A checked subagent result for Kokpit's delegation log, which moves a class of task to a stronger model " +
          "only after failures on capability. Call it as Kokpit's work-split note says.",
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'The class of task as a short slug, the same every time (e.g. "test-fix").' },
            model: { type: 'string', description: 'The model the subagent ran on: haiku, sonnet, opus or fable.' },
            difficulty: { type: 'integer', minimum: 1, maximum: 5 },
            outcome: { type: 'string', enum: OUTCOMES },
            cause: { type: 'string', enum: CAUSES, description: 'Only when outcome is not "pass".' },
          },
          required: ['kind', 'model', 'outcome'],
        },
      }),
    )
  }
  if (saved.local && saved.localModel) {
    opencodeOk = await hasCommand($, 'opencode')
    await registerOnce(() =>
      $.tool.register({
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
      }),
    )
  }
  await update($, economyAtom, () => ({ ...ECONOMY_0, active: saved, saved }))
  if (saved.effort) {
    await registerOnce(() =>
      $.tool.register({
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
      }),
    )
  }
  return saved
}

/** The delegation log's lessons for the work-split note, fixed per conversation (a change would break the cache). */
let delegationNote = ''

async function ledgerKey($: EngineInterface): Promise<string> {
  return `delegation:${await projectRoot($)}`
}

async function readLedger($: EngineInterface): Promise<LedgerEntry[]> {
  const ledger = parseLedger(await $.store.get(await ledgerKey($)))
  await update($, delegationAtom, () => ledger)
  return ledger
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

async function startHandoff($: EngineInterface, mode: LogMode, midWork?: boolean): Promise<void> {
  const usage = await read($, usageAtom)
  const now = await $.clock.now()
  await update($, handoffAtom, h => ({ ...h, running: true, startedAt: now, savedPath: null, midWork: midWork ?? h.midWork ?? false }))
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

/** Toast duration for a message held during a handoff or refresh. */
const LONG_TOAST_MS = 30_000

/** Holds a message; the desktop app shows `drop` only as "Prompt blocked by a hook", so the text also goes out as a toast. */
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
 * A background result for Claude: sent at once only in a quiet session; during a turn it waits for the turn's
 * end, and while Claude waits for the user it waits for the answer.
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

/** Releases results that arrived during the turn: to Claude, or into the inbox when `hold`. */
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
  const file = await inHome($, `${ANSWERS_DIR}/${thread}.md`)
  await attempt(async () => {
    await $.fs.write(file, answersMarkdown(thread, answers, new Date(await $.clock.now()).toISOString()))
    await flowSet($, 'pendingPrevious', file)
  }, undefined)
}

// ── Clearing: settings, thresholds, pausing background agents ──

/** Plugin settings for handoffs (set in register); the panel's choices override them. */
let handoffConfig: { soft: number; hard: number; clearMode: ClearMode } = { soft: 150_000, hard: 0, clearMode: 'message' }
const HANDOFF_SETTINGS_KEY = 'handoff-settings'
/** Briefs of the background agents this window started, for a pause before a clear (the module outlives /clear). */
const agentRecords = new Map<string, PausedAgent>()
const AGENT_RECORDS_MAX = 100
/** "Pause agents and clear" was pressed: the next clear pauses instead of waiting. */
let pauseNext = false
/** A pause did not stop everything: do not try again in this conversation. */
let pauseFailed = false

async function loadHandoffSettings($: EngineInterface): Promise<void> {
  const saved = parseHandoffSettings(await $.store.get(HANDOFF_SETTINGS_KEY))
  await update($, handoffSettingsAtom, () => saved)
}

async function saveHandoffSettings($: EngineInterface, change: (s: HandoffSettings) => HandoffSettings): Promise<void> {
  const next = change(await read($, handoffSettingsAtom))
  await $.store.set(HANDOFF_SETTINGS_KEY, next)
  await update($, handoffSettingsAtom, () => next)
}

async function limitsNow($: EngineInterface, window: number): Promise<{ soft: number; critical: number }> {
  return thresholds(await read($, handoffSettingsAtom), handoffConfig, window)
}

async function pastCritical($: EngineInterface): Promise<boolean> {
  const usage = await read($, usageAtom)
  if (!usage || usage.contextTokens === null) return false
  return usage.contextTokens >= (await limitsNow($, usage.contextWindow)).critical
}

async function pausedFile($: EngineInterface, thread: string): Promise<string> {
  return inHome($, `${PAUSED_DIR}/${thread}.json`)
}

async function readPaused($: EngineInterface, file: string): Promise<PausedRecord | null> {
  return attempt(async () => {
    const r = JSON.parse(await $.fs.read(file)) as PausedRecord
    return r && Array.isArray(r.agents) && r.agents.length + (r.commands?.length ?? 0) > 0 ? r : null
  }, null)
}

/** The paused record holding agent `id`, with its file. */
async function findPaused($: EngineInterface, id: string): Promise<{ file: string; record: PausedRecord; agent: PausedAgent } | null> {
  const dir = await inHome($, PAUSED_DIR)
  const entries = await attempt(() => $.fs.list(dir), [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const file = dir + '/' + entry.name
    const record = await readPaused($, file)
    const agent = record?.agents.find(a => a.id === id)
    if (record && agent) return { file, record, agent }
  }
  return null
}

/** Stops background agents and commands, records them for the resume, then clears; waits instead if a stop fails. */
async function pauseAndClear($: EngineInterface, path: string): Promise<void> {
  pauseNext = false
  type Info = { id: string; status: string; description: string; type: string; teammateId?: string; parentId?: string; model?: string; cwd?: string }
  const busy = (await attempt(() => $.agent.list(), [] as Info[])).filter(
    a => AGENT_BUSY.includes(a.status) && a.type !== 'teammate' && !a.teammateId,
  )
  const commands = lastBackground.filter(t => t.type !== 'subagent')
  for (const a of busy) await attempt(() => $.tool.call({ tool: 'TaskStop', task_id: a.id }), undefined)
  for (const c of commands) await attempt(() => $.tool.call({ tool: 'TaskStop', task_id: c.id }), undefined)
  await $.clock.sleep(1500)
  const still = (await attempt(() => $.agent.list(), [] as Info[])).filter(
    a => AGENT_BUSY.includes(a.status) && busy.some(b => b.id === a.id),
  )
  if (still.length > 0) {
    pauseFailed = true
    await update($, handoffAtom, h => ({ ...h, clearAfter: false, clearWhenIdle: true, busy: still.map(a => a.description || a.type) }))
    $.ui.toast(`Kokpit could not stop ${still.map(a => a.description || a.type).join(', ')}: clearing waits for their results.`)
    await flushPrompt($)
    return
  }
  const agents: PausedAgent[] = busy
    .filter(a => !a.parentId)
    .map(a => {
      const known = agentRecords.get(a.id)
      return known
        ? { ...known, cwd: known.cwd ?? a.cwd, model: known.model ?? a.model }
        : {
            id: a.id,
            description: a.description,
            subagentType: a.type,
            model: a.model,
            cwd: a.cwd,
            prompt: null,
            files: [],
            fork: false,
          }
    })
  const thread = threadName(path)
  const record: PausedRecord = {
    at: new Date(await $.clock.now()).toISOString(),
    thread,
    agents,
    commands: commands.map(c => c.description || c.type),
  }
  if (agents.length || record.commands.length) {
    await attempt(async () => $.fs.write(await pausedFile($, thread), JSON.stringify(record, null, 2) + '\n'), undefined)
  }
  lastBackground = []
  await update($, handoffAtom, h => ({ ...h, midWork: true }))
  const n = agents.length + record.commands.length
  if (n > 0) $.ui.toast(`Kokpit: paused ${n} background task${n === 1 ? '' : 's'} for the clear; agents start again after the resume.`)
  await clearAndResume($, path, true)
}

/** /clear and resuming the thread in a new session (through $.store, because /clear ends this session). */
async function clearAndResume($: EngineInterface, path: string, force = false): Promise<void> {
  // Background results go only to this conversation, which /clear ends: wait for them unless forced or paused.
  const busy = force ? [] : await backgroundWork($)
  if (busy.length > 0 && (pauseNext || (!pauseFailed && (await read($, handoffSettingsAtom)).autoClear && (await pastCritical($))))) {
    await pauseAndClear($, path)
    return
  }
  if (busy.length > 0) {
    await update($, handoffAtom, h => ({ ...h, clearAfter: false, clearWhenIdle: true, busy }))
    $.ui.toast(`Still running in the background: ${busy.join(', ')}. I will clear after their results, adding them to the thread first.`)
    await flushPrompt($)
    return
  }
  pauseNext = false
  const h = await update($, handoffAtom, x => ({ ...x, clearAfter: false, clearWhenIdle: false, busy: undefined }))
  const held = await takeInbox($)
  if (held.length > 0) await holdPrompt($, inboxText(held))
  await saveAnswers($, path)
  // By itself: only a report after a finished piece of work, the work goes on when it was cut mid-way.
  if ((await read($, handoffSettingsAtom)).autoClear) await flowSet($, 'pendingMode', h.midWork ? 'continue' : 'report')
  await flowSet($, 'pendingResume', await inHome($, path))
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch {
    $.ui.toast('Type /clear and Kokpit will run /resume by itself')
    await flowDelete($, 'pendingResume')
    await flushPrompt($)
  }
}

/** Refreshes the thread with a handoff, then clears once it is saved (`clearAfter`). */
async function refreshThenClear($: EngineInterface, mode: LogMode = 'button'): Promise<void> {
  await update($, handoffAtom, h => ({ ...h, clearAfter: true }))
  await startHandoff($, mode)
}

async function threadFiles($: EngineInterface): Promise<{ path: string; mtimeMs: number }[]> {
  const dir = await inHome($, HANDOFF_DIR)
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

/** End of a turn during a handoff, judged by thread file mtimes (a write may come from Bash or another surface). */
async function finishHandoff($: EngineInterface, aborted: boolean, answer: string): Promise<void> {
  const h = await read($, handoffAtom)
  if (!h.running) return
  const files = await attempt(() => threadFiles($), [] as { path: string; mtimeMs: number }[])
  const saved = pickSaved(files, h.startedAt)
  if (saved) {
    await noteSaved($, saved)
    return
  }
  // The skill's mark counts even when the file did not change (already up to date, or written in another worktree).
  const marked = aborted ? null : savedMark(answer)
  if (marked) {
    await noteSaved($, (await inHome($, HANDOFF_DIR)) + '/' + marked + '.md')
    return
  }
  await update($, handoffAtom, x => ({ ...x, running: false, clearAfter: false }))
  pendingMode = 'button'
  pendingTokens = 0
  const why = aborted ? 'Handoff interrupted: the thread file is unchanged.' : 'The handoff did not save a thread file.'
  $.ui.toast(h.clearAfter ? why + ' Not clearing the conversation.' : why)
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
  const graphifyInstalled = await attempt(
    async () => (await $.process.run(['bash', '-lc', 'command -v graphify'])).exitCode === 0,
    false,
  )
  const graph = await attempt(
    async () => {
      const r = await $.process.run(
        ['python3', '-I', setupScript($, 'setup.py'), 'graph', root, setupScript($, 'graphify_extensions.txt')],
        { timeoutMs: 20_000 },
      )
      return { share: parseShare(r.stdout), fits: r.exitCode === 0 }
    },
    { share: null as number | null, fits: false },
  )
  const { share, fits } = graph
  const graphOn = await attempt(
    async () => (await $.fs.exists(settingsFile)) && String(await $.fs.read(settingsFile)).includes('graphify'),
    false,
  )
  const hidden = await attempt(async () => {
    const project = (await $.settings.read({ source: 'project' })) as { skillOverrides?: Record<string, unknown> }
    return hiddenSkills(project.skillOverrides)
  }, [] as string[])
  const skills = await attempt(
    async () =>
      (await $.command.list())
        .filter(c => c.source === 'user')
        .map(c => ({ name: c.name, description: c.description }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [] as ToolsInfo['skills'],
  )
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

/** Job output by id; lost on a code reload. */
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
  // Not awaited: runs on after the hook returns.
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
    // Session root, not cwd: `cd` in Bash moves the session cwd.
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

/** The version in this plugin's own manifest; '' when it cannot be read. */
async function readVersion($: EngineInterface): Promise<string> {
  try {
    const manifest = JSON.parse(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
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

async function projectChecks($: EngineInterface): Promise<ChecksConfig> {
  try {
    return parseChecks(String(await $.fs.read(await inProject($, PROJECT_CONFIG))))
  } catch {
    return parseChecks(null)
  }
}

/** The path relative to the session root, or null outside the project. */
async function projectRelative($: EngineInterface, path: string): Promise<string | null> {
  const root = (await $.session.root()).replace(/\/+$/, '')
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : null
}

async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

/** Checks on what an edit added: suppressions, workaround comments, project patterns, the linter on changed lines. */
async function editNote($: EngineInterface, path: string, rel: string, before: string): Promise<string | null> {
  const c = await projectChecks($)
  if (!c.enabled) return null
  const added = addedLines(before, await readOrEmpty($, path))
  if (!added.length) return null
  const findings = findIssues(rel, added, c)
  const command = lintCommand(c, rel)
  let lint: string[] = []
  if (command) {
    const cwd = (await $.session.root()).replace(/\/+$/, '')
    const out = await $.process.run(lintArgv(command), { cwd, timeoutMs: LINT_TIMEOUT_MS })
    if (out.exitCode !== 0) lint = lintProblems(`${out.stdout}\n${out.stderr}`, rel, added.map(a => a.line))
  }
  return checksNote(rel, findings, lint)
}

/** The feature map's directory and number of pages, or null without one. */
async function featureMap($: EngineInterface): Promise<{ dir: string; pages: number } | null> {
  for (const dir of ['docs/features', 'docs/funkcje']) {
    const abs = await inProject($, dir)
    if (!(await attempt(() => $.fs.exists(abs + '/README.md'), false))) continue
    const entries = await attempt(async () => [...(await $.fs.list(abs))], [] as { name: string; kind: string }[])
    return { dir, pages: entries.filter(x => x.kind === 'file' && x.name.endsWith('.md') && x.name !== 'README.md').length }
  }
  return null
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
  handoffConfig = { soft: tokensSetting, hard: hardSetting, clearMode }
  const nudge = options?.taskNudge !== false
  const language = parseLanguage(options?.language)
  const decisionsSetting = typeof options?.decisionsFile === 'string' ? options.decisionsFile.trim() : ''
  let pluginVersion = ''
  // Re-resolved per session (the file may appear later); see decisionsPath.
  let decisionsFile = decisionsSetting || (language === 'pl' ? 'docs/decyzje.md' : 'docs/decisions.md')

  on('session.start', async ($, e, next) => {
    pluginVersion = await readVersion($)
    const usage = toUsage(await $.session.usage())
    await update($, usageAtom, () => usage)
    // A new session never has a handoff running; "Writing" left from a reload or /clear is stuck.
    await update($, handoffAtom, h => (h.running ? { ...h, running: false } : h))
    decisionsFile = await decisionsPath($, decisionsSetting, language)
    await refreshDecisions($, decisionsFile)
    await loadEconomy($).catch(() => ECONOMY_OFF)
    await loadQuality($).catch(() => undefined)
    await loadHandoffSettings($).catch(() => undefined)
    try {
      const keys = await $.store.keys()
      const values: Record<string, unknown> = {}
      for (const k of keys) if (k.startsWith('pendingAt:')) values[k] = await $.store.get(k)
      for (const k of orphanKeys(keys, values, await $.clock.now())) await $.store.delete(k)
    } catch {
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
    }
    return next(e)
  })

  // After /clear ($.state starts empty): /resume the thread from the bridge, then send the held message.
  on('classic.SessionStart', { source: ['clear'] }, async ($, e, next) => {
    // The prompt is rebuilt after /clear anyway, so Economy changes take effect here.
    await loadEconomy($).catch(() => ECONOMY_OFF)
    await loadQuality($).catch(() => undefined)
    await loadHandoffSettings($).catch(() => undefined)
    pauseFailed = false
    const fresh = isFresh(await flowGet($, 'pendingAt'), await $.clock.now())
    const resume = fresh ? ((await flowGet($, 'pendingResume')) as string | undefined) : undefined
    const after = fresh ? ((await flowGet($, 'pendingMode')) as string | undefined) : undefined
    const previous = fresh ? ((await flowGet($, 'pendingPrevious')) as string | undefined) : undefined
    const held = fresh ? ((await flowGet($, 'pendingPrompt')) as string | undefined) : undefined
    for (const key of FLOW_KEYS) await flowDelete($, key)
    if (held && !resume) $.ui.toast(`Kokpit: a held message was not sent (cleared without a resume): "${held.slice(0, 80)}"`)
    if (previous) await update($, previousAtom, () => previous)
    if (resume) {
      $.clock.after(0, async () => {
        // "after-clear": a message follows; "auto-clear": only a report (skills/resume/scripts/find.sh).
        await runSkill($, 'resume', threadName(resume) + (held ? ' after-clear' : after === 'report' ? ' auto-clear' : ''))
        if (held) {
          // A hidden conversation row: the model reads it, the user sees the answers in the pane.
          if (previous) {
            try {
              const text = previousContext(await $.fs.read(previous))
              await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
            } catch {
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
      const base = standard ? splitNoteStandard(standard.agents.split('/').pop() ?? '', e.model) : splitNote(e.model)
      const text = base + ' ' + largeSplitNote(`${$.plugin.root}/docs/large-split.md`) + RESULT_NOTE.trim() + delegationNote
      extra.push({ id: 'kokpit-split', text, scope: 'session' as const })
    }
    if (eco.effort) extra.push({ id: 'kokpit-effort', text: EFFORT_NOTE, scope: 'session' as const })
    if (eco.local && eco.localModel) {
      extra.push({ id: 'kokpit-local', text: localNote(eco.localModel, opencodeOk), scope: 'session' as const })
    }
    return { ...r, sections: [...r.sections, ...extra] }
  })

  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    return next({ ...e, instructions: [e.instructions, COMPACT_NOTE].filter(Boolean).join('\n') })
  }).catch(($, e, next) => next(e))

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

  // Plan mode blocks file writes: PLAN_NOTE replaces the skill and the handoff starts after plan mode.
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
        await update($, handoffAtom, x => ({ ...x, running: true, startedAt: now, savedPath: null, midWork: false }))
      }
      const r = await next(e)
      const lessons = (await read($, qualityAtom)).lessons ? '' : LESSONS_OFF_NOTE
      const auto = (await read($, handoffSettingsAtom)).autoClear ? AUTO_CLEAR_NOTE : ''
      return { text: r.text + handoffLanguageNote(language) + lessons + auto }
    }
    if (name === 'resume') {
      const r = await next(e)
      const chosen = /^CHOSEN THREAD: (.+)$/m.exec(r.text)?.[1]?.trim()
      const record = chosen ? await readPaused($, await pausedFile($, threadName(chosen))) : null
      return record ? { text: r.text + '\n' + pausedNote(record) } : r
    }
    if (name === 'setup') {
      const r = await next(e)
      return { text: r.text + setupLanguageNote(language) }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge' && e.origin.kind !== 'plugin') {
      const quiet = housekeepingNote(e.text)
      if (quiet) return { drop: `Kokpit: skipped a note — "${quiet.join('", "')}" only saved a handoff or resumed a thread.` }
      return next(e)
    }
    await update($, resumableAtom, () => null)
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && !e.command) {
      const held = await takeInbox($)
      if (held.length > 0) e = { ...e, context: [...(e.context ?? []), inboxText(held)] }
    }
    const autoClear = (await read($, handoffSettingsAtom)).autoClear
    if ((clearMode !== 'message' && !autoClear) || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)
    if (e.command || e.isMeta || (e.attachments && e.attachments.length > 0)) return next(e)
    const h = await read($, handoffAtom)
    if (h.planMode) return next(e)
    if (h.running) {
      await holdPrompt($, [e.text, ...(e.context ?? [])].join('\n\n'))
      await update($, handoffAtom, x => ({ ...x, clearAfter: true }))
      return heldNotice($, 'finishing the handoff, then I clear the conversation, resume the thread and send it in the new session.', LONG_TOAST_MS)
    }
    // e.turnId: sent during a running turn, which /clear would interrupt.
    if (!h.savedPath || e.turnId) return next(e)
    const busy = await backgroundWork($)
    if (busy.length > 0 && !(autoClear && !pauseFailed && (await pastCritical($)))) {
      // The message goes to this conversation; the clear comes after the background results.
      if (!h.clearWhenIdle) await update($, handoffAtom, x => ({ ...x, clearWhenIdle: true, busy }))
      return next(e)
    }
    const path = h.savedPath
    await holdPrompt($, [e.text, ...(e.context ?? [])].join('\n\n'))
    if (h.stale) {
      $.clock.after(0, () => refreshThenClear($, 'refresh'))
      return heldNotice($, `refreshing the thread "${threadName(path)}", then clearing the conversation and sending it in the new session.`, LONG_TOAST_MS)
    }
    $.clock.after(0, () => clearAndResume($, path))
    return heldNotice($, `clearing the conversation and resuming the thread "${threadName(path)}"; the message goes out in the new session.`)
  }).catch(($, e, next) => next(e))

  // The plan mode attachment comes with every request, the exit once.
  on('prompt.attachment', { type: ['plan_mode', 'plan_mode_reentry', 'plan_mode_exit'] }, async ($, e, next) => {
    if (!e.agentId) {
      const planMode = e.type !== 'plan_mode_exit'
      if ((await read($, handoffAtom)).planMode !== planMode) await update($, handoffAtom, h => ({ ...h, planMode }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── Economy ──

  // Not deferred behind ToolSearch, so the rating costs no extra step.
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

  on('tool.describe', { tool: 'mcp__kokpit__subagent_result' }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false })).catch(
    ($, e, next) => next(e),
  )

  on('tool.call', { tool: 'mcp__kokpit__subagent_result' }, async ($, e) => {
    const entry = entryFrom(e as unknown as Record<string, unknown>, new Date(await $.clock.now()).toISOString())
    if (typeof entry === 'string') return { result: entry }
    const before = routes(await readLedger($)).find(r => r.kind === entry.kind)
    const ledger = addEntry((await read($, delegationAtom)) ?? [], entry)
    await $.store.set(await ledgerKey($), ledger)
    await update($, delegationAtom, () => ledger)
    const now = routes(ledger).find(r => r.kind === entry.kind)
    const changed = now && (now.floor !== before?.floor || now.tryTier !== before?.tryTier)
    const lesson = changed ? ledgerNote([now]).replace(/^ What.*?: /, '').replace(/\.$/, '') : ''
    return { result: lesson ? `Recorded. From now on for this class: ${lesson}.` : 'Recorded.' }
  })

  on('tool.call', { tool: 'mcp__kokpit__effort_rating' }, async ($, e) => {
    const input = e as unknown as { rating?: unknown; reason?: unknown }
    if (!isRating(input.rating)) return { result: `Unknown rating; use one of: ${RATINGS.join(', ')}.` }
    const rating = input.rating
    const reason = typeof input.reason === 'string' ? input.reason.slice(0, 120) : ''
    const eco = await read($, economyAtom)
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

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!('isError' in r) || !r.isError) return r
    if (e.agentId) {
      agentErrors.set(e.agentId, (agentErrors.get(e.agentId) ?? 0) + 1)
      return r
    }
    const eco = await read($, economyAtom)
    if (eco.active.effort && eco.rating !== null) await update($, economyAtom, x => ({ ...x, bumps: x.bumps + 1 }))
    return r
  }).catch(($, e, next) => next(e))

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
        ceiling = eco.active.ceiling === 'session' ? e.effort : eco.active.ceiling
        const plan = (await read($, handoffAtom)).planMode
        want = plan ? ceiling : levelFor(eco.rating, eco.bumps, eco.active.floor, ceiling)
        if (eco.ceiling !== ceiling || eco.current !== want) await update($, economyAtom, x => ({ ...x, ceiling, current: want }))
        if (want !== e.effort) send = { ...e, effort: want }
      }
    }
    const r = yield* next(send)
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
        // Baseline without Economy: the main model (Explore runs on Haiku) and its effort; output rescaled by effort.
        const type = agentTypes.get(e.agentId ?? '') ?? ''
        const baseModel = type === 'Explore' ? 'haiku' : lastMainModel || e.model
        const subEffort: Level = isLevel(e.effort) ? e.effort : 'high'
        const baseEffort: Level = lastMainEffort ?? subEffort
        const scale = EFFORT_FACTOR[baseEffort] / EFFORT_FACTOR[subEffort]
        const cost = stepCost(usage, e.model, false)
        const base = stepCost(usage, baseModel, false, scale)
        economyTurn =
          priceFor(e.model).out > priceFor(baseModel).out
            ? { ...economyTurn, upCost: economyTurn.upCost + cost, upBaseline: economyTurn.upBaseline + base }
            : { ...economyTurn, subCost: economyTurn.subCost + cost, subBaseline: economyTurn.subBaseline + base }
      }
    } catch {
    }
    return r
  })

  on('tool.call', { tool: /^(Edit|Write|MultiEdit)$/ }, async ($, e, next) => {
    const path = String((e as { file_path?: unknown }).file_path ?? '')
    const record = e.agentId ? agentRecords.get(e.agentId) : undefined
    if (record && path && !record.files.includes(path) && record.files.length < 50) record.files.push(path)
    const rel = path ? await projectRelative($, path) : null
    if (!rel) return next(e)
    const checksOn = (await read($, qualityAtom)).checks
    const before = await readOrEmpty($, path)
    const r = await next(e)
    if (!('result' in r) || r.isError) return r
    if (isCode(rel) && (await read($, tasksAtom)).length) codeUnderTasks = true
    if (!checksOn) return r
    try {
      const note = await editNote($, path, rel, before)
      if (note) checkReports = { count: checkReports.count + 1, last: rel }
      return note ? ({ ...r, context: [...(r.context ?? []), note] } as typeof r) : r
    } catch {
      return r
    }
  }).catch(($, e, next) => next(e))

  on('tool.check', { tool: 'Write' }, async ($, e, next) => {
    const path = String((e.input as { file_path?: unknown } | null)?.file_path ?? '')
    if (!/\.md$/i.test(path)) return next(e)
    const rel = await projectRelative($, path)
    if (!rel || !(await read($, qualityAtom)).checks || (await $.fs.exists(path))) return next(e)
    if (markdownAllowed(await projectChecks($), rel)) return next(e)
    return { decision: 'ask', reason: MARKDOWN_REASON }
  }).catch(($, e, next) => next(e))

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

  on('agent.spawn', async ($, e, next) => {
    // A paused agent started again: the marker becomes its original brief, model and folder.
    const markId = markerId(e.prompt)
    const paused = markId ? await findPaused($, markId) : null
    if (markId && !paused) return { deny: `Kokpit: there is no paused agent ${markId} (already started again?).` }
    let input = e
    if (paused) {
      const a = paused.agent
      // An agent's own worktree may be gone (removed when it was stopped with nothing changed).
      const cwd = a.cwd && (await attempt(() => $.fs.exists(a.cwd as string), false)) ? a.cwd : undefined
      input = {
        ...e,
        prompt: continuePrompt(a),
        description: a.description || e.description,
        subagentType: a.subagentType || e.subagentType,
        background: true,
        ...(a.model ? { model: a.model } : {}),
        ...(cwd ? { cwd } : {}),
      }
    }
    const split = !paused && !e.fork && !e.workflow && (await read($, economyAtom)).active.split
    if (split) {
      const model = subagentModel(e.model, e.subagentType)
      if (model !== e.model) input = { ...input, model }
    }
    const r = await next(input)
    if (!('agentId' in r) || !r.agentId) return r
    if (split) {
      agentTypes.set(r.agentId, e.subagentType)
      if (agentTypes.size > 200) agentTypes.delete(agentTypes.keys().next().value ?? '')
    }
    if (input.background && !input.workflow && !input.isTeammate && !input.resume && !input.parentAgentId) {
      agentRecords.set(r.agentId, {
        id: r.agentId,
        description: input.description,
        subagentType: input.subagentType,
        model: r.model || input.model,
        cwd: input.cwd,
        prompt: paused ? paused.agent.prompt : input.fork ? null : input.prompt,
        files: paused ? paused.agent.files : [],
        fork: input.fork,
      })
      if (agentRecords.size > AGENT_RECORDS_MAX) agentRecords.delete(agentRecords.keys().next().value ?? '')
    }
    if (paused && markId) {
      const rest = afterRestart(paused.record, markId)
      await attempt(() => $.fs.write(paused.file, rest ? JSON.stringify(rest, null, 2) + '\n' : '{}\n'), undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== KOKPIT_PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const tab = await read($, tabAtom)
    const help = await read($, helpAtom)
    const root = (await $.session.root()).replace(/\/+$/, '')
    const project = await projectRoot($)
    const narrow = e.props.bodyColumns < 90
    const L = narrow ? 18 : 28

    const name = (path: string) => path.split('/').pop() || path
    const title = (text: string) => <Text bold>{text}</Text>
    const gap = <Text> </Text>
    const explain = (text: string) => (help ? <Text dimColor wrap="wrap">{text}</Text> : '')
    const row = (key: string, label: string, value: string, color?: string) => (
      <Box key={key} flexDirection="row">
        <Box width={L} flexShrink={0}>
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
    const toggle = (key: string, label: string, enabled: boolean, flip: () => unknown, note = '') => (
      <Box flexDirection="row" columnGap={2}>
        <Box width={L} flexShrink={0}>
          <Text>{label}</Text>
        </Box>
        {enabled ? (
          <Button key={key} label="● On " onPress={flip} />
        ) : (
          <Button key={key} label="○ Off" plain onPress={flip} />
        )}
        {note ? <Text dimColor wrap="wrap">{note}</Text> : ''}
      </Box>
    )
    const table = (key: string, head: string[], widths: number[], rows: { cells: string[]; color?: string }[]) => (
      <Box key={key} flexDirection="column">
        <Box flexDirection="row">
          {head.map((label, i) => (
            <Box key={`${key}-h${i}`} width={widths[i]}>
              <Text dimColor>{label}</Text>
            </Box>
          ))}
        </Box>
        {rows.map((r, n) => (
          <Box key={`${key}-r${n}`} flexDirection="row">
            {r.cells.map((c, i) => (
              <Box key={`${key}-r${n}c${i}`} width={widths[i]}>
                <Text color={i === 0 ? undefined : r.color} wrap={i === r.cells.length - 1 ? 'wrap' : 'truncate-end'}>
                  {c}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {choice('tab-', TABS, tab, t => update($, tabAtom, () => t))}
          <Button key="kokpit-help" label={help ? '? Hide help' : '? Help'} plain onPress={() => update($, helpAtom, shown => !shown)} />
        </Box>
        <Text dimColor>
          {`Kokpit ${pluginVersion || '?'} · ${name(project)}` + (root !== project ? ` · worktree ${name(root)}` : '')}
        </Text>
        {gap}
      </Box>
    )

    if (tab === 'economy') {
      const eco = await read($, economyAtom)
      const local = await read($, localAtom)
      const s = eco.saved
      const differs = (Object.keys(s) as (keyof EconomySettings)[]).some(key => s[key] !== eco.active[key])
      const ollama =
        local === null
          ? 'checking…'
          : !local.ollama
            ? 'Ollama not running'
            : `${local.models.length} models · opencode ${local.opencode ? '✓' : '✗ (text only)'}`
      return (
        <Box flexDirection="column">
          {header}
          {title('Model and effort')}
          {toggle('eco-split', 'Split across subagents', s.split, () => saveEconomy($, x => ({ ...x, split: !x.split })))}
          {explain(
            'Large tasks go to subagents; Claude picks Opus or Sonnet and an effort for each from a rubric. Haiku only ' +
              'as Explore, kokpit:reporter (test output verbatim) and kokpit:mechanic (a pattern-driven change with a ' +
              'check). A failed tool call raises a subagent’s effort.',
          )}
          {toggle('eco-effort', 'Dynamic effort', s.effort, () => saveEconomy($, x => ({ ...x, effort: !x.effort })))}
          {s.effort ? (
            <Box flexDirection="row">
              <Box width={L}>
                <Text dimColor>  lowest</Text>
              </Box>
              {choice('eco-floor-', (['low', 'medium', 'high'] as Level[]).map(l => ({ id: l, label: l })), s.floor, l =>
                saveEconomy($, x => ({ ...x, floor: l })),
              )}
            </Box>
          ) : (
            ''
          )}
          {s.effort ? (
            <Box flexDirection="row">
              <Box width={L}>
                <Text dimColor>  highest</Text>
              </Box>
              {choice(
                'eco-ceiling-',
                [
                  { id: 'session' as Level | 'session', label: 'session' },
                  ...(['high', 'xhigh', 'max'] as Level[]).map(l => ({ id: l as Level | 'session', label: l })),
                ],
                s.ceiling,
                l => saveEconomy($, x => ({ ...x, ceiling: l })),
              )}
            </Box>
          ) : (
            ''
          )}
          {explain(
            'Claude rates each request: simple → lowest, medium → high, hard → highest. A failed tool call raises it ' +
              'one level; plan mode stays at the highest. Only on 5.5 models and Fable 5.1, where changing effort keeps the cache.',
          )}
          {gap}
          {title('Local model')}
          {toggle('eco-local', 'Ollama', s.local, () => saveEconomy($, x => ({ ...x, local: !x.local })), ollama)}
          {s.local ? (
            <Box flexDirection="row" flexWrap="wrap">
              <Box width={L}>
                <Text dimColor>  model</Text>
              </Box>
              {local && local.models.length
                ? choice('eco-model-', local.models.map(m => ({ id: m, label: m })), s.localModel, m =>
                    saveEconomy($, x => ({ ...x, localModel: m })),
                  )
                : ''}
              <Button key="eco-local-refresh" label="Refresh" plain onPress={() => refreshLocal($)} />
            </Box>
          ) : (
            ''
          )}
          {s.local && !s.localModel ? <Text color="yellow">Pick a model: without one the local model does nothing.</Text> : ''}
          {explain('Text through Ollama directly; code through opencode in its own worktree, returned as a diff to review.')}
          {gap}
          {differs ? (
            <Text color="yellow">Takes effect in a new conversation or after /clear (keeps this one’s cache).</Text>
          ) : (
            <Text dimColor>Settings of this project, shared by its worktrees.</Text>
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
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {choice('eco-plan-', (['pro', 'x5', 'x20'] as Plan[]).map(p => ({ id: p, label: PLAN_NAME[p] })), plan, p =>
            setPlan($, p),
          )}
          {v && v.steps ? <Text dimColor>{`since ${v.since.slice(0, 10)} · ${v.steps.toLocaleString('en-US')} steps`}</Text> : ''}
        </Box>
      )
      if (!v || (v.steps === 0 && !v.subagents.length)) {
        return (
          <Box flexDirection="column">
            {header}
            {planRow}
            {gap}
            <Text dimColor>Nothing yet: stats are collected while Economy is on.</Text>
          </Box>
        )
      }
      const sign = (n: number) => (n >= 0 ? 'green' : 'red')
      const W = narrow ? [18, 16, 30] : [22, 18, 44]
      const sources: { cells: string[]; color?: string }[] = [
        {
          cells: [
            'Dynamic effort',
            v.lowered ? range(v.effort.usd, usd) : '—',
            v.lowered ? `${v.lowered} of ${v.steps} steps lower` : 'no step below the highest level',
          ],
          color: 'green',
        },
        {
          cells: [
            'Subagent routing',
            v.sub ? usd(v.sub.usd) : '—',
            v.sub
              ? `${Math.abs(Math.round(v.sub.pct))}% ${v.sub.pct >= 0 ? 'cheaper' : 'dearer'} than on the conversation’s model`
              : 'no subagents yet',
          ],
          color: v.sub ? sign(v.sub.usd) : undefined,
        },
      ]
      const ledger = (await read($, delegationAtom)) ?? (await readLedger($))
      const learned = routes(ledger).slice(0, 8)
      if (v.upgrade) {
        sources.push({ cells: ['Your picks', '+' + usd(v.upgrade.usd), 'your pricier subagents (e.g. Fable); not counted'], color: 'yellow' })
      }
      return (
        <Box flexDirection="column">
          {header}
          {planRow}
          {gap}
          <Box flexDirection="row" columnGap={3} flexWrap="wrap">
            <Text>
              <Text dimColor>Week </Text>
              {v.week ? (
                <Text bold color={sign(v.total.hi)}>{range(v.week.percent, pct)}</Text>
              ) : (
                <Text dimColor>{`calibrating (${pct(v.measured)} of 3%)`}</Text>
              )}
            </Text>
            <Text>
              <Text dimColor>Total </Text>
              <Text bold color={sign(v.total.lo)}>{range(v.total, usd)}</Text>
            </Text>
            <Text dimColor>{`saved on ${planName}, at API prices`}</Text>
          </Box>
          {gap}
          {table('st-src', ['Source', 'Saved', 'Detail'], W, sources)}
          {gap}
          {table(
            'st-lv',
            ['Effort', 'Steps', 'Avg output'],
            W,
            v.levels.map(p => ({ cells: [p.level, p.steps.toLocaleString('en-US'), p.avgOut.toLocaleString('en-US')] })),
          )}
          {gap}
          {row('st-ratings', 'Ratings', `simple ${v.ratings.simple} · medium ${v.ratings.medium} · hard ${v.ratings.hard}`)}
          {v.subagents.length
            ? row('st-subl', 'Subagents', v.subagents.slice(0, 6).map(x => `${x.key} ${x.n}`).join(' · '))
            : ''}
          {learned.length ? gap : ''}
          {learned.length
            ? table(
                'st-del',
                ['Task class', 'First try', 'Route'],
                W,
                learned.map(r => ({
                  cells: [
                    r.kind,
                    `${r.firstTry} of ${r.runs}`,
                    r.tryTier ? `try ${r.tryTier} (passes in a row)` : r.floor ? `at least ${r.floor} (${r.failed?.tier} lacked capability)` : 'rubric',
                  ],
                  color: r.tryTier ? 'green' : r.floor ? 'yellow' : undefined,
                })),
              )
            : ''}
          {v.unknownModels ? row('st-unk', 'Note', `${v.unknownModels} steps on unpriced models (counted as Opus 5.5)`, 'yellow') : ''}
          {help && v.week
            ? row('st-cal', 'Calibration', `${planName} week ≈ ${usd(v.week.usd)} · ${v.week.samples} samples over ${pct(v.week.measured)}`)
            : ''}
          {explain(
            'Every request’s tokens are measured and priced with the API price list. Estimates: effort (how much more a ' +
              'step at the highest level would think: high 1.2–1.6×, xhigh 1.5–2.5×, max 1.8–3.2× of medium) and ' +
              'subagents (the same tokens on the conversation’s model and effort; Explore against Haiku). Subagents you ' +
              'put on a pricier model than the conversation’s are your picks, shown apart. The week share compares the ' +
              'measured cost with the rise of the weekly counter; usage on other devices inflates it. Task classes come ' +
              'from the delegation log: a class moves to a stronger model only after a failure on capability, and one ' +
              'tier cheaper is suggested after 3 first-try passes in a row; the lessons reach Claude in a new conversation.',
          )}
          {gap}
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
      )
    }

    if (tab === 'quality') {
      const q = await read($, qualityAtom)
      const c = await projectChecks($)
      const map = await featureMap($)
      const checksNoteText = !c.enabled
        ? 'off in .claude/kokpit.json ("checks": false)'
        : [
            c.lint.length ? `linter on ${c.lint.map(r => r.files.join(', ')).join('; ')}` : 'no linter',
            c.suppressions ? 'suppressions' : '',
            c.excuses ? 'workaround comments' : '',
            c.patterns.length ? `${c.patterns.length} patterns` : '',
            c.markdown ? 'new markdown' : '',
          ]
            .filter(Boolean)
            .join(' · ')
      return (
        <Box flexDirection="column">
          {header}
          {title('This project')}
          {toggle('q-checks', 'Checks after every edit', q.checks, () => saveQuality($, x => ({ ...x, checks: !x.checks })), checksNoteText)}
          {explain(
            'After each Edit or Write Kokpit runs the project’s linter on the changed lines and flags added checker ' +
              'suppressions, workaround comments and forbidden patterns; a new markdown file outside the document ' +
              'places asks first. Silent when clean. The rules live in the checks section of .claude/kokpit.json.',
          )}
          {toggle(
            'q-verify',
            'Offer verification',
            q.verify,
            () => saveQuality($, x => ({ ...x, verify: !x.verify })),
            map ? `${map.dir}: ${map.pages} feature page${map.pages === 1 ? '' : 's'}` : 'no feature map yet',
          )}
          {explain(
            'When a task list completes after code changed, the band offers Verify: /kokpit:verify hands each affected ' +
              'feature of the map to a fresh agent that drives the app and saves evidence.',
          )}
          {toggle('q-lessons', 'Lessons at handoff', q.lessons, () => saveQuality($, x => ({ ...x, lessons: !x.lessons })), 'proposals to the decision register')}
          {explain(
            'A handoff proposes at most three skills or checks from what you corrected or asked for again. You accept ' +
              'them in /decisions; nothing is written during the handoff.',
          )}
          {gap}
          {title('This session')}
          {row(
            'q-reports',
            'Check reports',
            checkReports.count ? `${checkReports.count} · last on ${checkReports.last}` : 'none',
            checkReports.count ? 'yellow' : undefined,
          )}
          {c.enabled && !c.lint.length ? (
            <Text color="yellow" wrap="wrap">
              No linter runs on edits yet: /kokpit:setup project sets the quality bar for this repo.
            </Text>
          ) : (
            ''
          )}
          {!map ? <Text dimColor wrap="wrap">A feature map comes with /kokpit:setup project (audit item “proof”).</Text> : ''}
          {gap}
          <Text dimColor>Applies at once, to this project on this machine.</Text>
        </Box>
      )
    }

    const usage = await read($, usageAtom)
    const log = ((await $.store.get('log')) as HandoffLogEntry[] | undefined) ?? []
    const win = usage?.contextWindow ?? 200_000
    const hs = await read($, handoffSettingsAtom)
    const lim = thresholds(hs, handoffConfig, win)
    const softWanted = hs.soft ?? handoffConfig.soft
    const criticalWanted = hs.critical ?? (handoffConfig.hard > 0 ? handoffConfig.hard : softWanted + CRITICAL_EXTRA)
    // "default" stays a button of its own, so picking a number never makes the default value disappear.
    const pick = (
      key: string,
      label: string,
      choices: number[],
      stored: number | null,
      fallback: number,
      note: string,
      set: (v: number | null) => unknown,
    ) => (
      <Box key={key} flexDirection="column">
        <Box flexDirection="row">
          <Box width={L} flexShrink={0}>
            <Text>{label}</Text>
          </Box>
          {choice(
            key + '-',
            [
              { id: 'default', label: `default ${k(fallback)}` },
              ...[...new Set([...choices.filter(v => v !== fallback), ...(stored === null ? [] : [stored])])].sort((a, b) => a - b).map(v => ({
                id: String(v),
                label: k(v),
              })),
            ],
            stored === null ? 'default' : String(stored),
            v => set(v === 'default' ? null : Number(v)),
          )}
        </Box>
        <Box flexDirection="row">
          <Box width={L} flexShrink={0} />
          <Text dimColor wrap="wrap">
            {note}
          </Text>
        </Box>
      </Box>
    )
    const softDefault = handoffConfig.soft
    const criticalDefault = handoffConfig.hard > 0 ? handoffConfig.hard : softWanted + CRITICAL_EXTRA
    const capped = lim.soft !== softWanted || lim.critical !== Math.max(criticalWanted, lim.soft)
    const decisions = await read($, decisionsAtom)
    return (
      <Box flexDirection="column">
        {header}
        {title('Context')}
        {toggle(
          'h-auto',
          'Clear by itself',
          hs.autoClear,
          () => saveHandoffSettings($, x => ({ ...x, autoClear: !x.autoClear })),
          'after the thread is saved; waits for background work',
        )}
        {pick(
          'h-soft',
          'Clear threshold',
          SOFT_CHOICES,
          hs.soft,
          softDefault,
          'from here: a handoff once the current task is finished, then the clear',
          v => saveHandoffSettings($, x => ({ ...x, soft: v })),
        )}
        {pick(
          'h-crit',
          'Critical threshold',
          CRITICAL_CHOICES,
          hs.critical,
          criticalDefault,
          hs.autoClear
            ? 'from here: a handoff even mid-task; background agents are paused, then restarted after the clear'
            : 'from here: a handoff even mid-task, without waiting for it to finish',
          v => saveHandoffSettings($, x => ({ ...x, critical: v })),
        )}
        {criticalWanted <= softWanted
          ? row('h-order', 'Note', `critical is not above the clear threshold, so both act at ${k(lim.soft)}`, 'yellow')
          : ''}
        {capped ? row('h-cap', 'For this model', `${k(lim.soft)} · ${k(lim.critical)} (window ${k(win)})`, 'yellow') : ''}
        {explain(
          '"default" follows the plugin settings (critical: clear + 100k). Both stop at 75% and 85% of the model\'s ' +
            'window. Paused agents keep their partial work on disk and continue from it. These apply to all projects.',
        )}
        {gap}
        {title('Handoff')}
        {row('h-mode', 'Mode', mode === 'auto' ? 'auto, after the threshold' : mode === 'break' ? 'break, after a finished task' : 'button only')}
        {row('h-clear', 'Clearing', hs.autoClear ? 'by itself' : clearMode === 'message' ? 'on your next message' : 'with the button')}
        {row('h-lang', 'Language', language === 'pl' ? 'Polish' : 'English')}
        {row('h-stats', 'History', stats(log, await $.clock.now()))}
        {explain('Mode and language: /plugin → kokpit → Configure, then /reload-plugins. Language applies to new threads, register entries and templates.')}
        {gap}
        {title('Tools')}
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          <Button
            key="h-decisions"
            label={`Decisions${decisions ? ` (${decisions.pending})` : ''}`}
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
    lastBackground = (e.background_tasks ?? []).map(t => ({ id: t.id, type: t.type, description: t.description }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      askedThisTurn = false
      turnRunning = true
      const eco = await read($, economyAtom)
      if (eco.active.effort && (eco.rating !== null || eco.bumps > 0)) {
        await update($, economyAtom, x => ({ ...x, rating: null, reason: '', bumps: 0 }))
      }
    }
    currentTurnId = e.turnId
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    turnRunning = false
    await flushEconomyStats($).catch(() => {})
    const tasks = await read($, tasksAtom)
    if (codeUnderTasks && !e.isAborted && tasks.length && isFinished(tasks)) {
      codeUnderTasks = false
      if ((await read($, qualityAtom)).verify) await update($, verifyOfferAtom, () => true)
    }
    const wasRunning = (await read($, handoffAtom)).running
    if (wasRunning) await finishHandoff($, e.isAborted, e.answer ?? '')
    else if (!e.isAborted) {
      const answer = (e.answer ?? '').trim()
      if (answer) {
        const at = new Date(await $.clock.now()).toISOString()
        await update($, answersAtom, a => [...a, { at, text: answer }].slice(-ANSWERS_KEEP))
      }
      const awaiting = askedThisTurn || endsWithQuestion(answer)
      if ((await read($, handoffAtom)).awaiting !== awaiting) await update($, handoffAtom, x => ({ ...x, awaiting }))
    }
    await releaseAfterTurn($, wasRunning || (await read($, handoffAtom)).awaiting)
    const h = await read($, handoffAtom)
    if (h.savedPath && e.turnId === h.savedTurnId) {
      if (h.clearAfter || (await read($, handoffSettingsAtom)).autoClear) {
        const path = h.savedPath
        $.clock.after(0, () => clearAndResume($, path))
      }
      return r
    }
    if (wasRunning) return r
    if (h.savedPath && !h.stale) await update($, handoffAtom, x => ({ ...x, stale: true }))
    if (h.planMode) return r
    if (h.clearWhenIdle) {
      const idle = (await backgroundWork($)).length === 0
      const pause = !idle && !pauseFailed && (await read($, handoffSettingsAtom)).autoClear && (await pastCritical($))
      // The thread is refreshed first: with the results, or with what happened while waiting before a pause.
      if (h.savedPath && (idle || pause)) {
        await update($, handoffAtom, x => ({ ...x, clearWhenIdle: false }))
        $.clock.after(0, () => refreshThenClear($))
      }
      return r
    }
    if (e.isAborted) return r
    if (h.afterPlan) {
      await update($, handoffAtom, x => ({ ...x, afterPlan: false }))
      $.clock.after(0, () => startHandoff($, 'button'))
      return r
    }
    if (mode === 'button') return r
    const usage = await read($, usageAtom)
    if (!usage) return r
    const { soft, critical } = await limitsNow($, usage.contextWindow)
    const now = await read($, handoffAtom)
    const listDone = isFinished(await read($, tasksAtom))
    const finished = !now.awaiting && (mode === 'auto' || listDone)
    if (!autoDue(usage.contextTokens, soft, critical, now, finished)) return r
    // After the current event: the turn has to close first.
    $.clock.after(0, () => startHandoff($, mode, !listDone))
    return r
  })

  // ── Task list (TaskCreate/TaskUpdate; TodoWrite on older engines) ──
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

  // The desktop app keeps the task list with its own tool, not TaskCreate.
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

  on('tool.check', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const path = (e.input as { file_path?: unknown } | null)?.file_path
    // The main checkout is asked only for a path into a handoff folder: projectRoot may run git.
    if (
      typeof path === 'string' &&
      (isHandoffPath(path, await $.session.root()) ||
        (path.includes('/' + HANDOFF_DIR + '/') && isHandoffPath(path, await projectRoot($))))
    ) {
      return { decision: 'allow' }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const r = await next(e)
    if (r.isError || (e.tool !== 'Write' && e.tool !== 'Edit')) return r
    const path = e.file_path.startsWith('/') ? e.file_path : (await $.session.cwd()).replace(/\/+$/, '') + '/' + e.file_path
    if (path.endsWith('/' + decisionsFile) || path === decisionsFile) await refreshDecisions($, decisionsFile)
    if (path.includes('/' + HANDOFF_DIR + '/') && !path.includes('/.previous/') && !path.includes('/.poprzednie/') && isThreadFile(path)) {
      if ((await read($, handoffAtom)).running) await noteSaved($, path)
    }
    return r
  }).catch(($, e, next) => next(e))

  // ── Previous answers pane ──
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PREVIOUS_PANE) return next(e)
    const { Text, Markdown } = $.ui.resolve(e)
    const file = await read($, previousAtom)
    let text = ''
    try {
      text = file ? await $.fs.read(file) : ''
    } catch {
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
    // Input exists only in the terminal and the desktop app.
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
    const { soft: threshold, critical: hard } = await limitsNow($, usage.contextWindow)
    const autoClear = (await read($, handoffSettingsAtom)).autoClear
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
                (handoff.busy && handoff.busy.length > 0 ? ` (${handoff.busy.slice(0, 3).join(', ')})` : '') +
                (autoClear && !pauseFailed ? `, or pause them from ${k(hard)}` : '')}
            </Text>
          ) : handoff.stale ? (
            <Text color="yellow">{`⚠ Thread "${threadName(path)}" saved earlier; the conversation moved on`}</Text>
          ) : (
            <Text color="green">
              {`✓ Thread "${threadName(path)}" saved` +
                (autoClear ? '; clearing and resuming…' : clearMode === 'message' ? '; your next message clears and resumes' : '')}
            </Text>
          )}
          <Button
            key="kokpit-clear-resume"
            label={handoff.stale ? 'Refresh, clear and resume' : 'Clear and resume'}
            hotkey="1"
            onPress={() => (handoff.stale ? refreshThenClear($) : clearAndResume($, path))}
          />
          {handoff.clearWhenIdle ? (
            <Button
              key="kokpit-pause-clear"
              label="Pause them and clear"
              hotkey="2"
              onPress={() => {
                pauseNext = true
                pauseFailed = false
                return handoff.stale ? refreshThenClear($) : clearAndResume($, path)
              }}
            />
          ) : (
            ''
          )}
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
          ? 'after this turn (critical threshold)'
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

    const verifyRow =
      (await read($, verifyOfferAtom)) && !e.props.isWorking ? (
        <Box flexDirection="row" columnGap={2}>
          <Text>✓ Tasks done: prove the change works the way its user meets it?</Text>
          <Button
            key="kokpit-verify"
            label="Verify"
            hotkey="3"
            onPress={async () => {
              await update($, verifyOfferAtom, () => false)
              await runSkill($, 'verify', '')
            }}
          />
          <Button key="kokpit-verify-no" label="Not now" plain onPress={() => update($, verifyOfferAtom, () => false)} />
        </Box>
      ) : (
        ''
      )

    return (
      <Box flexDirection="column">
        {meters}
        {jobRows}
        {inboxRows}
        {verifyRow}
        {action}
      </Box>
    )
  })
}
