import type { LedgerEntry } from '../types'

export type { LedgerEntry }
export type Outcome = LedgerEntry['outcome']
/** Only `model` says the model was too weak; the other causes are fixed without a stronger one. */
export type Cause = NonNullable<LedgerEntry['cause']>
export type Tier = LedgerEntry['tier']

export const RESULT_TOOL = 'subagent_result'
export const OUTCOMES: Outcome[] = ['pass', 'fixed', 'fail']
export const CAUSES: Cause[] = ['model', 'brief', 'context', 'environment', 'flaky']
const TIERS: Tier[] = ['haiku', 'sonnet', 'opus', 'fable']
const LEDGER_MAX = 300
/** First-try passes in a row on a tier before one tier cheaper is suggested. */
export const DEMOTE_AFTER = 3
/** Classes shown in the note for the model; the stats pane shows more. */
const NOTE_KINDS = 8

export function tierOf(model: string): Tier | null {
  return TIERS.find(t => model.toLowerCase().includes(t)) ?? null
}

const rankOf = (t: Tier) => TIERS.indexOf(t)

/** A task class as a stable slug: "Godot scene edit" and "godot-scene-edit" are one class. */
export function kindSlug(kind: string): string {
  return kind
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function parseLedger(raw: unknown): LedgerEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (x): x is LedgerEntry =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as LedgerEntry).kind === 'string' &&
      TIERS.includes((x as LedgerEntry).tier) &&
      OUTCOMES.includes((x as LedgerEntry).outcome),
  )
}

/** The entry for a tool call, or the reason it cannot be recorded. */
export function entryFrom(input: Record<string, unknown>, at: string): LedgerEntry | string {
  const kind = typeof input.kind === 'string' ? kindSlug(input.kind) : ''
  if (!kind) return 'Give `kind`: a short slug for the kind of task, the same one every time (e.g. "test-fix").'
  const tier = typeof input.model === 'string' ? tierOf(input.model) : null
  if (!tier) return `Give \`model\`: the model the subagent ran on (${TIERS.join(', ')}).`
  const outcome = input.outcome
  if (!OUTCOMES.includes(outcome as Outcome)) return `\`outcome\` is one of: ${OUTCOMES.join(', ')}.`
  const cause = input.cause
  if (outcome !== 'pass' && !CAUSES.includes(cause as Cause)) return `When it was not a first-try pass, give \`cause\`: one of ${CAUSES.join(', ')}.`
  const d = Number(input.difficulty)
  const difficulty = Number.isFinite(d) ? Math.min(5, Math.max(1, Math.round(d))) : 3
  return { at, kind, difficulty, tier, outcome: outcome as Outcome, ...(outcome !== 'pass' ? { cause: cause as Cause } : {}) }
}

export function addEntry(ledger: LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  return [...ledger, entry].slice(-LEDGER_MAX)
}

export type Route = {
  kind: string
  runs: number
  firstTry: number
  /** The cheapest tier that has not failed on the model since; null = no lesson. */
  floor: Tier | null
  /** The tier that failed on the model, and when. */
  failed: { tier: Tier; at: string } | null
  /** A cheaper tier worth trying: DEMOTE_AFTER first-try passes in a row on the one above. */
  tryTier: Tier | null
  last: string
}

/** A demotion is not suggested to a tier that failed on capability within this many latest runs of the class. */
const RECENT = 10

/**
 * What the log teaches per class. A failure on the model raises the floor above that tier; failures for any other
 * cause change nothing (fix the brief, not the model). A pass below the floor lowers it. DEMOTE_AFTER first-try
 * passes in a row on one tier suggest the tier below, unless that tier failed on capability recently; never Haiku
 * (Kokpit keeps Haiku to three narrow roles).
 */
export function routes(ledger: LedgerEntry[]): Route[] {
  const byKind = new Map<string, LedgerEntry[]>()
  for (const e of ledger) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e])
  const out: Route[] = []
  for (const [kind, all] of byKind) {
    const es = [...all].sort((a, b) => a.at.localeCompare(b.at))
    let floor: Tier | null = null
    let failed: Route['failed'] = null
    let streak: { tier: Tier | null; n: number } = { tier: null, n: 0 }
    for (const e of es) {
      if (e.outcome === 'pass') {
        streak = streak.tier === e.tier ? { tier: e.tier, n: streak.n + 1 } : { tier: e.tier, n: 1 }
        if (floor && rankOf(e.tier) < rankOf(floor)) floor = e.tier
        continue
      }
      streak = { tier: null, n: 0 }
      if (e.cause !== 'model') continue
      const up = TIERS[Math.min(rankOf(e.tier) + 1, TIERS.length - 1)] ?? e.tier
      if (!floor || rankOf(up) > rankOf(floor)) floor = up
      failed = { tier: e.tier, at: e.at }
    }
    const below = streak.tier && streak.n >= DEMOTE_AFTER ? TIERS[rankOf(streak.tier) - 1] : undefined
    const recentFail = (t: Tier) => es.slice(-RECENT).some(e => e.tier === t && e.outcome !== 'pass' && e.cause === 'model')
    out.push({
      kind,
      runs: es.length,
      firstTry: es.filter(e => e.outcome === 'pass').length,
      floor,
      failed,
      tryTier: below && below !== 'haiku' && !recentFail(below) ? below : null,
      last: es[es.length - 1]?.at ?? '',
    })
  }
  return out.sort((a, b) => b.last.localeCompare(a.last))
}

/** One line per class with a lesson, for the work-split note; empty when the log teaches nothing yet. */
export function ledgerNote(rs: Route[]): string {
  const lines = rs
    .filter(r => r.floor || r.tryTier)
    .slice(0, NOTE_KINDS)
    .map(r =>
      r.tryTier
        ? `"${r.kind}": ${DEMOTE_AFTER}+ first-try passes in a row, try ${r.tryTier} next`
        : `"${r.kind}": at least ${r.floor} (${r.failed?.tier} failed on capability ${r.failed?.at.slice(0, 10)})`,
    )
  if (!lines.length) return ''
  return (
    ' What this project\'s delegation log has learned (it overrides the rubric for these classes): ' +
    lines.join('; ') +
    '.'
  )
}

export const RESULT_NOTE =
  ' After you check a subagent\'s work, record it with mcp__kokpit__subagent_result in parallel with your next tool ' +
  'call (not for Explore searches or kokpit:reporter runs): `kind` a short slug for the class of task, the same slug ' +
  'every time; `outcome` pass (accepted as delivered), fixed (needed a correction or a retry) or fail (unusable); ' +
  'and when it was not a pass, `cause`: model only when it lacked the capability, otherwise brief, context, ' +
  'environment or flaky. Only "model" makes Kokpit route that class to a stronger model.'

/** Rules every subagent brief follows (ideas from Hermes advanced-delegation). */
export const BRIEF_RULES =
  'Every brief also names the files the subagent may change (nothing else), says it does not commit and does not ' +
  'edit skills, rules or CLAUDE.md, and asks its report to end with "Decisions for the parent to record" (names it ' +
  'chose, defaults, deviations from the brief): carry those into the decision register or the thread. '

export function largeSplitNote(path: string): string {
  return `Before a split into 3 or more subagents, or parts that share files or an interface, read ${path} and follow it. `
}
