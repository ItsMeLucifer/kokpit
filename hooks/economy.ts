// Economy: splitting work across subagents with a fitting model and effort, and dynamic effort for the
// main conversation. Pure rules only; the engine wiring lives in register.tsx.

import type { Calibration, EconomySettings, EconomyStats, Level, Plan, Rating } from '../types'

export type { Calibration, EconomySettings, EconomyStats, Level, Plan, Rating }

export const LEVELS: Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const RATINGS: Rating[] = ['simple', 'medium', 'hard']

export const ECONOMY_OFF: EconomySettings = {
  split: false,
  effort: false,
  floor: 'medium',
  ceiling: 'xhigh',
  local: false,
  localModel: '',
}

/** Field names used before 0.10 (Polish), mapped to the current ones. */
const LEGACY_SETTINGS: Record<string, keyof EconomySettings> = {
  podzial: 'split',
  wysilek: 'effort',
  dno: 'floor',
  sufit: 'ceiling',
  lokalny: 'local',
  lokalnyModel: 'localModel',
}

function renamed(raw: Record<string, unknown>, legacy: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw }
  for (const [old, current] of Object.entries(legacy)) if (!(current in out) && old in raw) out[current] = raw[old]
  return out
}

export function parseSettings(raw: unknown): EconomySettings {
  if (!raw || typeof raw !== 'object') return ECONOMY_OFF
  const r = renamed(raw as Record<string, unknown>, LEGACY_SETTINGS) as Partial<Record<keyof EconomySettings, unknown>>
  const floor = isLevel(r.floor) && r.floor !== 'max' ? r.floor : 'medium'
  const ceiling = r.ceiling === 'session' || r.ceiling === 'sesja' ? 'session' : isLevel(r.ceiling) ? r.ceiling : 'xhigh'
  const localModel = typeof r.localModel === 'string' && /^[\w.:/-]+$/.test(r.localModel) ? r.localModel : ''
  return { split: r.split === true, effort: r.effort === true, floor, ceiling, local: r.local === true, localModel }
}

export function rank(l: Level): number {
  return LEVELS.indexOf(l)
}

export function isLevel(x: unknown): x is Level {
  return typeof x === 'string' && (LEVELS as string[]).includes(x)
}

export function isRating(x: unknown): x is Rating {
  return typeof x === 'string' && (RATINGS as string[]).includes(x)
}

/**
 * Models on which changing effort mid-conversation keeps the prompt cache (Opus/Sonnet/Haiku 5.5 and
 * Fable 5.1, on a subscription or an API key). Elsewhere a change would re-read the whole conversation.
 */
export function effortCacheSafe(model: string): boolean {
  return /(opus|sonnet|haiku)-5-5|fable-5-1/.test(model)
}

/**
 * Effort for a main-conversation step. No rating yet → the ceiling. simple → floor, medium → high,
 * hard → ceiling; every bump (a failed tool call) adds one level, never above the ceiling.
 */
export function levelFor(rating: Rating | null, bumps: number, floor: Level, ceiling: Level): Level {
  if (rating === null || rank(ceiling) <= rank(floor)) return ceiling
  const base: Level =
    rating === 'simple' ? floor : rating === 'medium' ? (rank(floor) > rank('high') ? floor : 'high') : ceiling
  const raised = Math.min(rank(base) + Math.max(0, bumps), rank(ceiling))
  return LEVELS[Math.max(raised, rank(floor))] ?? ceiling
}

/** Subagent types allowed to run on Haiku: narrow scope, cheap to verify. */
export const HAIKU_TYPES = ['Explore', 'kokpit:reporter', 'kokpit:mechanic']

/** Kokpit's Haiku agents: duties live in their own prompt, with an explicit "ABORTED" instead of guessing. */
export const HAIKU_AGENTS = [
  {
    name: 'reporter',
    description:
      'Haiku: runs the given commands (tests, build, a short benchmark) and reports the result verbatim: what ' +
      'failed, file:line, the error text. No diagnosis and no file changes.',
    tools: ['Bash', 'Read', 'Grep', 'Glob'],
    model: 'haiku',
    effort: 'low',
    prompt:
      'You are a reporting agent. Run exactly the commands in the brief; change nothing and fix nothing. ' +
      'Report: first line "DONE" or "ABORTED: <reason>" (a command did not start, a file is missing). Then for ' +
      'each command: exit code, passed/failed counts, and for every failure the test name, file:line and the ' +
      'message copied verbatim. Do not guess causes or suggest fixes. Shorten long logs only by cutting: keep ' +
      'the failing lines and their immediate context.',
  },
  {
    name: 'mechanic',
    description:
      'Haiku: applies a change fully described by a pattern (a rename across files, the same edit in N places, ' +
      'data conversion from a given table) and runs the given check. Stops when something needs a decision.',
    tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
    model: 'haiku',
    effort: 'medium',
    prompt:
      'You are an agent for mechanical changes. Do exactly what the brief describes, following the given ' +
      'pattern, only in the listed files or places the brief points to unambiguously. Do not design, do not fix ' +
      'anything outside the scope, do not change logic. Stop at once and describe the spot when: the pattern ' +
      'does not fit a place, you would have to choose between two reasonable options, the change reaches beyond ' +
      'the listed files, or the check fails for a reason other than your own obvious slip (fix that once). ' +
      'Finally run the check from the brief (grep, test). Report: first line "DONE" or "ABORTED: <file:line, ' +
      'reason>", then the changed files and the check output verbatim. Stopping beats guessing.',
  },
]

/** Haiku is allowed only for HAIKU_TYPES; a Haiku request for any other subagent gets Sonnet. */
export function subagentModel(model: string | undefined, subagentType: string): string | undefined {
  if (model && /haiku/i.test(model) && !HAIKU_TYPES.includes(subagentType)) return 'sonnet'
  return model
}

/** Subagent effort when the conversation gave none: reporter low, other Haiku roles medium, the rest high. */
export function subagentEffort(effort: string | undefined, subagentType: string): string {
  if (effort) return effort
  if (subagentType === 'kokpit:reporter') return 'low'
  return HAIKU_TYPES.includes(subagentType) ? 'medium' : 'high'
}

/** Effort for a subagent step: its start level plus one per failed tool call in it, at most xhigh. */
export function subagentStepLevel(start: Level, errors: number): Level {
  const r = Math.min(rank(start) + Math.max(0, errors), rank('xhigh'))
  return LEVELS[Math.max(r, rank(start))] ?? start
}

export function emptyStats(at: string): EconomyStats {
  return {
    since: at,
    steps: {},
    lowered: 0,
    ratings: {},
    subagents: {},
    savedOutput: 0,
    savedEffortUsd: 0,
    subCost: 0,
    subBaseline: 0,
    lowerings: {},
    unknownModels: 0,
  }
}

const LEGACY_STATS: Record<string, keyof EconomyStats> = {
  od: 'since',
  kroki: 'steps',
  obnizone: 'lowered',
  oceny: 'ratings',
  subagenci: 'subagents',
  zaoszczWyjscie: 'savedOutput',
  zaoszczWysilek: 'savedEffortUsd',
  subKoszt: 'subCost',
  subBez: 'subBaseline',
  obnizenia: 'lowerings',
  nieznaneModele: 'unknownModels',
}
const LEGACY_RATINGS: Record<string, Rating> = { prosta: 'simple', srednia: 'medium', trudna: 'hard' }

export function parseStats(raw: unknown, at: string): EconomyStats {
  if (!raw || typeof raw !== 'object') return emptyStats(at)
  const r = renamed(raw as Record<string, unknown>, LEGACY_STATS) as Partial<Record<keyof EconomyStats, unknown>>
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  const obj = <T,>(x: unknown): T => (x && typeof x === 'object' ? (x as T) : ({} as T))
  const ratings: Partial<Record<Rating, number>> = {}
  for (const [key, n] of Object.entries(obj<Record<string, number>>(r.ratings))) {
    const rating = LEGACY_RATINGS[key] ?? (isRating(key) ? key : null)
    if (rating) ratings[rating] = (ratings[rating] ?? 0) + num(n)
  }
  return {
    since: typeof r.since === 'string' ? r.since : at,
    steps: obj(r.steps),
    lowered: num(r.lowered),
    ratings,
    subagents: obj(r.subagents),
    savedOutput: num(r.savedOutput),
    savedEffortUsd: num(r.savedEffortUsd),
    subCost: num(r.subCost),
    subBaseline: num(r.subBaseline),
    lowerings: obj(r.lowerings),
    unknownModels: num(r.unknownModels),
  }
}

function sumMap(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v
  return out
}

/** Adds what one turn collected (steps, ratings, subagents) to the stored stats. */
export function mergeStats(s: EconomyStats, d: EconomyStats): EconomyStats {
  const steps = { ...s.steps }
  for (const l of LEVELS) {
    const add = d.steps[l]
    if (!add) continue
    const cur = steps[l] ?? { n: 0, out: 0 }
    steps[l] = { n: cur.n + add.n, out: cur.out + add.out }
  }
  const ratings = { ...s.ratings }
  for (const r of RATINGS) if (d.ratings[r]) ratings[r] = (ratings[r] ?? 0) + (d.ratings[r] ?? 0)
  return {
    since: s.since,
    steps,
    lowered: s.lowered + d.lowered,
    ratings,
    subagents: sumMap(s.subagents, d.subagents),
    savedOutput: s.savedOutput + d.savedOutput,
    savedEffortUsd: s.savedEffortUsd + d.savedEffortUsd,
    subCost: s.subCost + d.subCost,
    subBaseline: s.subBaseline + d.subBaseline,
    lowerings: sumMap(s.lowerings, d.lowerings),
    unknownModels: s.unknownModels + d.unknownModels,
  }
}

export const RATING_TOOL = 'effort_rating'

export const EFFORT_NOTE =
  'Kokpit (dynamic effort): your reasoning level follows the difficulty of the task. You start at the highest ' +
  'configured level and step down after your own rating. At the start of every new user request, in your first ' +
  'response and IN PARALLEL with the first real tool call (not as a separate step), call ' +
  'mcp__kokpit__effort_rating with: "simple" — mechanical or clearly specified, a known pattern, a small change; ' +
  '"medium" — a typical implementation across a few files with a familiar API; "hard" — design, a bug with an ' +
  'unknown cause, subtle domain logic, decisions that are hard to undo, unclear requirements. When in doubt, pick ' +
  'the higher one. If the work turns out harder, call it again with a higher rating. If you answer directly ' +
  'without tools, do not call it at all.'

/** Model rubric and how far to trust reports: part of Kokpit in every repo. */
const SPLIT_RUBRIC =
  'The user explicitly asks you to set the model and effort parameters for EVERY subagent according to this ' +
  'rubric: • opus + high — design, a bug with an unknown cause, cross-cutting changes, subtle domain logic, ' +
  'anything unclear; opus + xhigh — only when a mistake would be expensive or hard to undo; ' +
  '• sonnet + high — a precisely described function in one module, with tests; ' +
  '• sonnet + medium — mechanical changes following a given pattern, running tests and reporting, documentation ' +
  'from provided content; ' +
  '• haiku — only three subagent types, each with a narrow scope: Explore (find files, symbols, usages — low; ' +
  'trace a flow across a few files and summarize — medium), kokpit:reporter (run the given commands: tests, ' +
  'build, a short benchmark, and report the output verbatim — low), kokpit:mechanic (a change fully described ' +
  'by a pattern: a rename across files, the same edit in N places, data conversion from a given table; include ' +
  'a check in the brief — grep or a test — medium). Haiku never gets: design, debugging, new logic beyond the ' +
  'pattern, reviews or decisions. ' +
  'Trust: accept a DONE report with a passing check — do not redo the work or re-read every file, only check ' +
  'what you touch next anyway; use paths from Explore directly and search again only when one proves wrong. ' +
  'ABORTED or a failing check → do it yourself or via sonnet, never retry on haiku. '

export const SPLIT_NOTE =
  'Kokpit (work split): for a large task (many files or independent parts, more than a dozen or so steps) ' +
  'start by breaking it into subtasks and delegate independent parts to subagents (the Agent tool), in parallel ' +
  'where independent. Keep integration, design decisions and the final verification in the main conversation. ' +
  SPLIT_RUBRIC +
  'Do not delegate trivia (up to ~3 steps): a subagent reads the files again from scratch, so it costs more. ' +
  'A subagent prompt must be self-contained (files, goal, acceptance criteria, "do not ask, decide and ' +
  'explain"), because it does not see this conversation. Two subagents must never edit the same file in parallel.'

/** In a repo that follows the Kokpit repo standard, the delegation rules belong to org-rules; here only the rubric. */
export function splitNoteStandard(rulesFile: string): string {
  return (
    `Kokpit (work split): the rules for splitting and delegating work and for subagent briefs are in org-rules ` +
    `(${rulesFile}). ` +
    SPLIT_RUBRIC.trimEnd()
  )
}

// ── Savings estimate and conversion to the weekly limit ──

/** API prices per million tokens (October 2026): a common measure across models; the subscription limit weighs models too. */
type Price = { in: number; out: number; cw5m: number; cw1h: number; cr: number }
const PRICES: { re: RegExp; p: Price }[] = [
  { re: /fable-5-1/, p: { in: 10, out: 50, cw5m: 12.5, cw1h: 20, cr: 0.25 } },
  { re: /opus-5-5/, p: { in: 4, out: 20, cw5m: 5, cw1h: 8, cr: 0.2 } },
  { re: /sonnet-5-5/, p: { in: 2, out: 10, cw5m: 2.5, cw1h: 4, cr: 0.1 } },
  { re: /haiku-5-5/, p: { in: 0.1, out: 0.5, cw5m: 0.125, cw1h: 0.2, cr: 0.01 } },
  { re: /opus-5(\D|$)/, p: { in: 5, out: 25, cw5m: 6.25, cw1h: 10, cr: 0.5 } },
  { re: /sonnet-5(\D|$)/, p: { in: 2, out: 10, cw5m: 2.5, cw1h: 4, cr: 0.2 } },
  { re: /fable/, p: { in: 10, out: 50, cw5m: 12.5, cw1h: 20, cr: 0.25 } },
  { re: /haiku/, p: { in: 0.1, out: 0.5, cw5m: 0.125, cw1h: 0.2, cr: 0.01 } },
  { re: /sonnet/, p: { in: 2, out: 10, cw5m: 2.5, cw1h: 4, cr: 0.1 } },
]
const OPUS_PRICE: Price = { in: 4, out: 20, cw5m: 5, cw1h: 8, cr: 0.2 }
/** Haiku 5.5 prompts above 100k tokens are billed at a higher tier. */
const HAIKU_LONG: Price = { in: 0.5, out: 2.5, cw5m: 0.625, cw1h: 1, cr: 0.05 }

export function knownModel(model: string): boolean {
  return PRICES.some(x => x.re.test(model))
}

export function priceFor(model: string): Price {
  return PRICES.find(x => x.re.test(model))?.p ?? OPUS_PRICE
}

export type StepUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * Cost of one request in API dollars. Cache writes: the main conversation on a subscription uses the
 * one-hour TTL, subagents the five-minute one. `outScale` scales output (the "at another level" scenario).
 */
export function stepCost(u: StepUsage | null | undefined, model: string, main: boolean, outScale = 1): number {
  if (!u) return 0
  const prompt = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  const p = /haiku/.test(model) && prompt > 100_000 ? HAIKU_LONG : priceFor(model)
  return (
    ((u.input_tokens ?? 0) * p.in +
      (u.output_tokens ?? 0) * outScale * p.out +
      (u.cache_read_input_tokens ?? 0) * p.cr +
      (u.cache_creation_input_tokens ?? 0) * (main ? p.cw1h : p.cw5m)) /
    1e6
  )
}

/**
 * Point estimate of how many times more output (mostly thinking) a step produces at a level than at medium.
 * Used only for the live counter; the stats view uses EFFORT_RANGE.
 */
export const EFFORT_FACTOR: Record<Level, number> = { low: 0.7, medium: 1, high: 1.4, xhigh: 2, max: 2.6 }

/** Output tokens a step at `actual` did not produce compared with `ceiling`. */
export function savedOutput(out: number, actual: Level, ceiling: Level): number {
  const ratio = EFFORT_FACTOR[ceiling] / EFFORT_FACTOR[actual]
  return ratio > 1 ? out * (ratio - 1) : 0
}

export const CALIBRATION_0: Calibration = { cost: 0, percent: 0, samples: 0, last: null, accrued: 0 }

const LEGACY_CALIBRATION: Record<string, keyof Calibration> = {
  koszt: 'cost',
  procent: 'percent',
  pomiary: 'samples',
  ostatni: 'last',
  narosle: 'accrued',
}

export function parseCalibration(raw: unknown): Calibration {
  if (!raw || typeof raw !== 'object') return CALIBRATION_0
  const r = renamed(raw as Record<string, unknown>, LEGACY_CALIBRATION) as Partial<Record<keyof Calibration, unknown>>
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    cost: num(r.cost),
    percent: num(r.percent),
    samples: num(r.samples),
    last: typeof r.last === 'number' ? r.last : null,
    accrued: num(r.accrued),
  }
}

/** Adds a request's cost to the current increment. */
export function calibrationAddCost(c: Calibration, cost: number): Calibration {
  return { ...c, accrued: c.accrued + cost }
}

/**
 * A new weekly reading: a rise closes a sample (cost since the previous reading ↔ the rise). A drop (old
 * usage left the 7-day window) discards the accrued cost, because it cannot be attributed.
 */
export function calibrationReading(c: Calibration, percent: number): Calibration {
  if (c.last === null) return { ...c, last: percent, accrued: 0 }
  if (percent < c.last) return { ...c, last: percent, accrued: 0 }
  if (percent === c.last) return c
  if (c.accrued <= 0) return { ...c, last: percent }
  return {
    cost: c.cost + c.accrued,
    percent: c.percent + (percent - c.last),
    samples: c.samples + 1,
    last: percent,
    accrued: 0,
  }
}

/** API dollars that make up a full week on the plan; null until enough was measured (< 3 percentage points). */
export function weekCost(c: Calibration): number | null {
  if (c.percent < 3 || c.cost <= 0) return null
  return (c.cost / c.percent) * 100
}

export const PLAN_NAME: Record<Plan, string> = { pro: 'Pro', x5: 'Max x5', x20: 'Max x20' }

/** Savings as a percentage of the week on the calibrated plan; null without calibration. */
export function weekPercent(savings: number, c: Calibration): number | null {
  const week = weekCost(c)
  return week === null ? null : (savings / week) * 100
}

/**
 * Range of how many times more output (mostly thinking) a step produces at a level than at medium.
 * The model already shortens thinking on simple steps, so the difference is uncertain: a range, not a number.
 */
export const EFFORT_RANGE: Record<Level, [number, number]> = {
  low: [0.6, 0.8],
  medium: [1, 1],
  high: [1.2, 1.6],
  xhigh: [1.5, 2.5],
  max: [1.8, 3.2],
}

export type Range = { lo: number; hi: number }

/** Effort savings from raw data: output tokens and dollars, lower and upper bound. */
export function effortSavings(lowerings: Record<string, number>): { tokens: Range; usd: Range } {
  const tokens = { lo: 0, hi: 0 }
  const usd = { lo: 0, hi: 0 }
  for (const [key, out] of Object.entries(lowerings)) {
    const m = /^(.*)\|(\w+)>(\w+)$/.exec(key)
    if (!m) continue
    const [, model, ceiling, actual] = m
    if (!isLevel(ceiling) || !isLevel(actual)) continue
    const lo = Math.max(0, out * (EFFORT_RANGE[ceiling][0] / EFFORT_RANGE[actual][1] - 1))
    const hi = Math.max(0, out * (EFFORT_RANGE[ceiling][1] / EFFORT_RANGE[actual][0] - 1))
    const price = priceFor(model ?? '').out / 1e6
    tokens.lo += lo
    tokens.hi += hi
    usd.lo += lo * price
    usd.hi += hi * price
  }
  return { tokens, usd }
}

/** Everything the stats tab shows: numbers only, no text. */
export type StatsView = {
  since: string
  steps: number
  levels: { level: Level; steps: number; avgOut: number }[]
  lowered: number
  ratings: Record<Rating, number>
  subagents: { key: string; n: number }[]
  effort: { tokens: Range; usd: Range }
  /** Subagents: savings in dollars (negative = more expensive) and relative to the no-Economy scenario; null without data. */
  sub: { usd: number; pct: number } | null
  total: Range
  /** Share of the selected plan's week (range) and the week in API dollars; null before calibration. */
  week: { percent: Range; usd: number; samples: number; measured: number } | null
  measured: number
  unknownModels: number
}

export function statsView(st: EconomyStats, c: Calibration): StatsView {
  const levels = LEVELS.filter(l => st.steps[l]?.n).map(l => {
    const x = st.steps[l] ?? { n: 0, out: 0 }
    return { level: l, steps: x.n, avgOut: Math.round(x.out / Math.max(1, x.n)) }
  })
  const steps = levels.reduce((a, x) => a + x.steps, 0)
  // Stats from before 0.8 have no raw lowerings: show the old point estimate.
  const effort = Object.keys(st.lowerings).length
    ? effortSavings(st.lowerings)
    : { tokens: { lo: st.savedOutput, hi: st.savedOutput }, usd: { lo: st.savedEffortUsd, hi: st.savedEffortUsd } }
  const sub =
    st.subBaseline > 0
      ? { usd: st.subBaseline - st.subCost, pct: ((st.subBaseline - st.subCost) / st.subBaseline) * 100 }
      : null
  const total = { lo: effort.usd.lo + (sub?.usd ?? 0), hi: effort.usd.hi + (sub?.usd ?? 0) }
  const week = weekCost(c)
  return {
    since: st.since,
    steps,
    levels,
    lowered: st.lowered,
    ratings: { simple: st.ratings.simple ?? 0, medium: st.ratings.medium ?? 0, hard: st.ratings.hard ?? 0 },
    subagents: Object.entries(st.subagents)
      .map(([key, n]) => ({ key, n }))
      .sort((a, b) => b.n - a.n),
    effort,
    sub,
    total,
    week:
      week === null
        ? null
        : { percent: { lo: (total.lo / week) * 100, hi: (total.hi / week) * 100 }, usd: week, samples: c.samples, measured: c.percent },
    measured: c.percent,
    unknownModels: st.unknownModels,
  }
}

/** Compact count: 950, 12.3k, 1.2M. */
export function compact(n: number): string {
  const a = Math.abs(n)
  if (a < 1000) return String(Math.round(n))
  if (a >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`
  return `${Math.round(n / 100) / 10}k`
}

export function usd(n: number): string {
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  return sign + '$' + (a >= 100 ? Math.round(a).toString() : a.toFixed(2))
}

export function pct(n: number): string {
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  return sign + (a < 0.1 ? a.toFixed(2) : a.toFixed(1)) + '%'
}

/** "a–b", or a single number when the bounds meet. */
export function range(r: Range, fmt: (n: number) => string): string {
  return Math.abs(r.hi - r.lo) < 1e-9 ? fmt(r.lo) : `${fmt(r.lo)}–${fmt(r.hi)}`
}

// ── Local model (Ollama, opencode) ──

export const LOCAL_TOOL = 'local_model'
export const LOCAL_DIR = '.claude/kokpit/local'

export function localNote(model: string, opencode: boolean): string {
  return (
    `Kokpit (local model ${model} via Ollama): free for the usage limit, but slower and weaker than you. ` +
    'The mcp__kokpit__local_model tool hands it work in the background and returns at once; the result arrives ' +
    'as a message from Kokpit. Mode "text": summarize a long log or results, draft documentation or a description ' +
    'from provided content, translate, extract data from text. ' +
    (opencode
      ? 'Mode "code": mechanical changes following a precisely given pattern, tests modelled on existing ones, ' +
        'repetitive fixes across many files. It runs in a separate worktree from the last commit and comes back ' +
        'as a diff: review it before `git apply` (on a conflict with uncommitted changes `git apply --3way`), ' +
        'and reject a weak one. '
      : 'Mode "code" is unavailable (no opencode on this machine). ') +
    'Do not hand it: design, debugging, subtle domain logic, anything unclear. The brief must be self-contained ' +
    '(files, pattern, acceptance criteria), because the model does not see this conversation. If the result is ' +
    'weak, do not iterate on it: do it yourself or through a subagent.'
  )
}

/** Shell single quotes. */
export function sq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Command: the model's answer to a prompt from a file (Ollama reads the prompt from stdin). */
export function localTextCmd(model: string, promptFile: string): string {
  return `ollama run ${sq(model)} < ${sq(promptFile)}`
}

/**
 * Command: a separate worktree from HEAD, opencode with an Ollama model, the diff saved next to it.
 * The worktree stays for review; the output prints the cleanup command.
 */
export function localCodeCmd(root: string, id: string, model: string, promptFile: string): string {
  const wt = `${root}/${LOCAL_DIR}/${id}`
  const diff = `${root}/${LOCAL_DIR}/${id}.diff`
  return [
    'set -e',
    `git -C ${sq(root)} worktree add -q -b ${sq('kokpit-local/' + id)} ${sq(wt)} HEAD`,
    `cd ${sq(wt)}`,
    `opencode run -m ${sq('ollama/' + model)} "$(cat ${sq(promptFile)})" || echo "opencode: failed (exit $?)"`,
    'git add -A',
    'echo "--- changes ---"',
    'git diff --cached HEAD --stat',
    `git diff --cached HEAD > ${sq(diff)}`,
    `echo "DIFF: ${LOCAL_DIR}/${id}.diff"`,
    `echo "WORKTREE: ${LOCAL_DIR}/${id} (branch kokpit-local/${id})"`,
    `echo "Cleanup: git worktree remove --force ${LOCAL_DIR}/${id} && git branch -D kokpit-local/${id}"`,
  ].join('\n')
}

/** Model names from `ollama list` (first column, header skipped). */
export function parseOllamaList(out: string): string[] {
  return out
    .split('\n')
    .slice(1)
    .map(l => l.trim().split(/\s+/)[0] ?? '')
    .filter(n => /^[\w.:/-]+$/.test(n))
}
