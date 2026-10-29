import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  calibrationAddCost,
  calibrationReading,
  effortCacheSafe,
  effortSavings,
  emptyStats,
  levelFor,
  localCodeCmd,
  localTextCmd,
  mergeStats,
  parseCalibration,
  parseOllamaList,
  parseSettings,
  parseStats,
  savedOutput,
  statsView,
  stepCost,
  subagentEffort,
  subagentModel,
  subagentStepLevel,
  weekCost,
  weekPercent,
} from '../hooks/economy'

const SURFACES = ['terminal', 'desktop'] as const
const near = (a: number | null | undefined, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-6
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 12, contentRows: 2 },
  view: 'main',
} as never
const OPUS = 'claude-opus-5-5'
const ON = { split: true, effort: true, floor: 'medium' }
const COMPOSE = { sections: [], model: OPUS, promptModel: OPUS, outputStyle: null, tools: [], traits: [], surfaces: ['terminal'] } as never
const PANE_PROPS = { title: 'Kokpit', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 60, contentRows: 60 }, view: 'main' } as never

// ── Pure rules ──

test('level: ceiling without a rating, then from the rating; a failure raises it, never above the ceiling or below the floor', () => {
  expect(levelFor(null, 0, 'medium', 'xhigh')).toBe('xhigh')
  expect(levelFor('simple', 0, 'medium', 'xhigh')).toBe('medium')
  expect(levelFor('medium', 0, 'medium', 'xhigh')).toBe('high')
  expect(levelFor('hard', 0, 'medium', 'xhigh')).toBe('xhigh')
  expect(levelFor('simple', 1, 'medium', 'xhigh')).toBe('high')
  expect(levelFor('simple', 5, 'medium', 'xhigh')).toBe('xhigh')
  // a session already at medium: nowhere to go down, and never above the user's choice
  expect(levelFor('hard', 0, 'medium', 'medium')).toBe('medium')
  // floor high: simple and medium → high
  expect(levelFor('simple', 0, 'high', 'xhigh')).toBe('high')
  expect(levelFor('medium', 0, 'low', 'max')).toBe('high')
})

test('effort changes only on models where they keep the cache', () => {
  expect(effortCacheSafe('claude-opus-5-5')).toBe(true)
  expect(effortCacheSafe('claude-sonnet-5-5[1m]')).toBe(true)
  expect(effortCacheSafe('claude-fable-5-1')).toBe(true)
  expect(effortCacheSafe('claude-opus-4-8')).toBe(false)
  expect(effortCacheSafe('claude-sonnet-5')).toBe(false)
})

test('subagent: Haiku only in Explore, default effort, a bump after a failure', () => {
  expect(subagentModel('haiku', 'general-purpose')).toBe('sonnet')
  expect(subagentModel('claude-haiku-5-5', 'x')).toBe('sonnet')
  expect(subagentModel('haiku', 'Explore')).toBe('haiku')
  expect(subagentModel(undefined, 'Explore')).toBeUndefined()
  expect(subagentModel(undefined, 'general-purpose')).toBeUndefined()
  expect(subagentModel('opus', 'Explore')).toBe('opus')
  expect(subagentEffort(undefined, 'Explore')).toBe('medium')
  expect(subagentEffort(undefined, 'general-purpose')).toBe('high')
  expect(subagentEffort('low', 'Explore')).toBe('low')
  expect(subagentStepLevel('low', 1)).toBe('medium')
  expect(subagentStepLevel('high', 5)).toBe('xhigh')
  // Haiku above 100k prompt tokens: the higher price tier
  expect(stepCost({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 200_000 }, 'claude-haiku-5-5', false)).toBe(0.01)
})

test('settings: off by default, floor never max, settings from before 0.10 still read', () => {
  const off = { split: false, effort: false, floor: 'medium', ceiling: 'xhigh', local: false, localModel: '' }
  expect(parseSettings(undefined)).toEqual(off)
  expect(parseSettings({ split: true, floor: 'max' })).toEqual({ ...off, split: true })
  expect(parseSettings({ effort: true, floor: 'low' })).toEqual({ ...off, effort: true, floor: 'low' })
  expect(parseSettings({ podzial: true, wysilek: true, dno: 'low', sufit: 'sesja', lokalny: true, lokalnyModel: 'qwen3:8b' })).toEqual({
    split: true,
    effort: true,
    floor: 'low',
    ceiling: 'session',
    local: true,
    localModel: 'qwen3:8b',
  })
})

test('stats add up, and stats from before 0.10 are read', () => {
  const a = { ...emptyStats('2026-10-23'), steps: { medium: { n: 2, out: 300 } }, ratings: { simple: 1 }, subagents: { 'sonnet/medium': 1 } }
  const b = { ...emptyStats(''), steps: { medium: { n: 1, out: 100 }, xhigh: { n: 1, out: 900 } }, lowered: 1, subagents: { 'sonnet/medium': 2 } }
  const m = mergeStats(a, b)
  expect(m.steps).toEqual({ medium: { n: 3, out: 400 }, xhigh: { n: 1, out: 900 } })
  expect(m.subagents).toEqual({ 'sonnet/medium': 3 })
  expect(m.lowered).toBe(1)
  expect(m.since).toBe('2026-10-23')
  const legacy = parseStats({ od: '2026-10-01', kroki: { high: { n: 4, out: 40 } }, obnizone: 2, oceny: { prosta: 3, trudna: 1 }, subBez: 5 }, 'x')
  expect(legacy).toMatchObject({ since: '2026-10-01', steps: { high: { n: 4, out: 40 } }, lowered: 2, ratings: { simple: 3, hard: 1 }, subBaseline: 5 })
})

// ── In a session ──

/** An engine under the plugin: store, session start, model requests that record the effort sent. */
function engine(
  on: On,
  mem: Record<string, unknown>,
  sent: { effort?: unknown; model: string }[],
  root = '/p',
  exists: (path: string) => boolean = () => false,
) {
  on('store.get', (_$, e) => ({ value: mem[e.key] }))
  on('store.set', (_$, e) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: root }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.usage', () => ({ value: { context: { tokens: 10_000, window: 200_000, percent: 5 }, rateLimits: [] } as never }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('fs.exists', (_$, e) => ({ value: exists(String((e as { path?: unknown }).path)) }))
  on('tool.register', () => ({ value: undefined as never }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', async () => ({ cwd: '/p' }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('prompt.attachment', async () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    sent.push({ effort: e.effort, model: e.model })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { output_tokens: 500 } } as never
  })
  return mock.clock(on, { now: Date.parse('2026-10-23T10:00:00Z') })
}

async function step($: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } }, model = OPUS, effort = 'xhigh') {
  const s = $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 3 } as never)
  for await (const _ of s) {
    // no chunks in the test stream
  }
  return s.result
}

test('effort: xhigh until rated, "simple" → medium, a tool failure → high, plan mode → ceiling', async ($, on) => {
  const mem: Record<string, unknown> = { 'economy:/p': ON }
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  on('tool.call', async (_$, e) => (e.tool === 'Bash' ? { result: 'exit 1', isError: true } : { result: {} as never }) as never)
  await $.session.start({ cwd: '/p' } as never)

  await $.turn.start({ text: 'fix a typo in the README', turnId: 't1' })
  await step($ as never)
  const r = await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'simple', reason: 'one line' } as never)
  expect(String((r as { result?: unknown }).result)).toContain('medium')
  await step($ as never)
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  await step($ as never)
  expect(sent.map(x => x.effort)).toEqual(['xhigh', 'medium', 'high'])

  // a model outside 5.5: changing effort would burn the cache, so it stays
  await step($ as never, 'claude-opus-4-8')
  expect(sent[3]?.effort).toBe('xhigh')

  // plan mode: the ceiling
  await $.prompt.attachment({ type: 'plan_mode', text: '', detail: { reminder: 'full', planFilePath: '/x', hasPlan: false } } as never)
  await step($ as never)
  expect(sent[4]?.effort).toBe('xhigh')
})

test('a new request starts at the ceiling, and stats reach the store', async ($, on) => {
  const mem: Record<string, unknown> = { 'economy:/p': ON }
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  on('tool.call', async () => ({ result: {} as never }))
  await $.session.start({ cwd: '/p' } as never)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'simple' } as never)
  await step($ as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await $.turn.start({ text: 'b', turnId: 't2' })
  await step($ as never)
  expect(sent.map(x => x.effort)).toEqual(['medium', 'xhigh'])
  const st = mem['economy-stats:/p'] as { steps: Record<string, { n: number; out: number }>; ratings: Record<string, number> }
  expect(st.steps.medium).toEqual({ n: 1, out: 500 })
  expect(st.ratings.simple).toBe(1)
})

test('settings and stats stored before 0.10 move to the new keys', async ($, on) => {
  const mem: Record<string, unknown> = {
    'ekonom:/p': { podzial: false, wysilek: true, dno: 'medium', sufit: 'xhigh' },
    'ekonom-stat:/p': { od: '2026-10-01', kroki: { high: { n: 2, out: 10 } }, oceny: {}, subagenci: {}, obnizenia: {} },
  }
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  on('tool.call', async () => ({ result: {} as never }))
  await $.session.start({ cwd: '/p' } as never)
  expect(mem['economy:/p']).toBeDefined()
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'simple' } as never)
  await step($ as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(sent.map(x => x.effort)).toEqual(['medium'])
  const st = mem['economy-stats:/p'] as { since: string; steps: Record<string, { n: number }> }
  expect(st.since).toBe('2026-10-01')
  expect(st.steps.high?.n).toBe(2)
  expect(st.steps.medium?.n).toBe(1)
})

test('Economy off changes nothing and adds nothing to the prompt', async ($, on) => {
  const mem: Record<string, unknown> = {}
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  let agentInput: Record<string, unknown> = {}
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Agent') agentInput = e as never
    return { result: {} as never }
  })
  on('prompt.compose', async () => ({ sections: [] }))
  await $.session.start({ cwd: '/p' } as never)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await step($ as never)
  await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y', model: 'haiku' } as never)
  const composed = await $.prompt.compose(COMPOSE)
  expect(sent[0]?.effort).toBe('xhigh')
  expect(agentInput.model).toBe('haiku')
  expect(JSON.stringify(composed)).not.toContain('Kokpit (work split)')
})

test('split: note in the prompt, Haiku outside Explore → Sonnet, Explore stays on Haiku at medium', async ($, on) => {
  const mem: Record<string, unknown> = { 'economy:/p': { split: true, effort: false, floor: 'medium' } }
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  const agents: Record<string, unknown>[] = []
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Agent') agents.push(e as never)
    return { result: {} as never }
  })
  let spawned: string | undefined
  on('agent.spawn', async (_$, e) => {
    spawned = e.model
    return { model: e.model ?? 'inherit' }
  })
  on('prompt.compose', async () => ({ sections: [] }))
  await $.session.start({ cwd: '/p' } as never)
  const composed = await $.prompt.compose(COMPOSE)
  expect(JSON.stringify(composed)).toContain('Kokpit (work split)')
  expect(JSON.stringify(composed)).not.toContain('Kokpit (dynamic effort)')

  await $.tool.call({ tool: 'Agent', description: 'change', prompt: 'fix', model: 'haiku' } as never)
  await $.tool.call({ tool: 'Agent', description: 'design', prompt: 'design it', model: 'opus', effort: 'xhigh' } as never)
  await $.tool.call({ tool: 'Agent', description: 'search', prompt: 'find', subagent_type: 'Explore' } as never)
  expect(agents[0]).toMatchObject({ model: 'sonnet', effort: 'high' })
  expect(agents[1]).toMatchObject({ model: 'opus', effort: 'xhigh' })
  expect(agents[2]).toMatchObject({ effort: 'medium' })
  expect(agents[2]?.model).toBeUndefined()

  await $.agent.spawn({ tool_use_id: 'u1', prompt: 'p', description: 'd', subagentType: 'Explore', parentModel: OPUS, background: false, fork: false } as never)
  expect(spawned).toBeUndefined()
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  const st = mem['economy-stats:/p'] as { subagents: Record<string, number> }
  expect(st.subagents).toEqual({ 'sonnet/high': 1, 'opus/xhigh': 1, 'haiku/medium': 1 })
})

for (const [core, agentsFile, knowledgeFile] of [
  ['English', '00-core-agents.md', '00-core-knowledge.md'],
  ['Polish', '00-rdzen-praca-agentow.md', '00-rdzen-wiedza.md'],
] as const) {
  test(`repo standard (${core} core): split and register notes point to org-rules instead of repeating them`, async ($, on) => {
    const mem: Record<string, unknown> = { 'economy:/p': { split: true, effort: false, floor: 'medium' } }
    engine(on, mem, [], '/p', path => path.endsWith('.claude/org-rules/' + agentsFile))
    on('prompt.compose', async () => ({ sections: [] }))
    await $.session.start({ cwd: '/p' } as never)
    const composed = JSON.stringify(await $.prompt.compose(COMPOSE))
    expect(composed).toContain(agentsFile)
    expect(composed).toContain('opus + high')
    expect(composed).not.toContain('Do not delegate trivia')
    expect(composed).toContain(knowledgeFile)
    expect(composed).not.toContain('Entry format')
  })
}

for (const surface of SURFACES) {
  test(`${surface}: the band shows the step down from the ceiling, the pane saves project settings`, async ($, on) => {
    const mem: Record<string, unknown> = { 'economy:/p': ON }
    const sent: { effort?: unknown; model: string }[] = []
    engine(on, mem, sent)
    on('tool.call', async () => ({ result: {} as never }))
    on('ui.open', () => ({ value: undefined as never }))
    await $.session.start({ cwd: '/p' } as never)
    await $.session.measure({ context: { tokens: 10_000, window: 200_000, percent: 5 }, rateLimits: [], changed: ['context'] } as never)
    await $.turn.start({ text: 'a', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'simple' } as never)
    await step($ as never)
    const band = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    const drawn = JSON.stringify(await band.drawn())
    expect(drawn).toContain('xhigh→medium')
    expect(drawn).toContain('(simple)')

    await $.command.run({ command: 'kokpit', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'kokpit', surface, component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-panel' })
    await pane.press({ key: 'eco-split' })
    expect(mem['economy:/p']).toEqual({ split: false, effort: true, floor: 'medium', ceiling: 'xhigh', local: false, localModel: '' })
    expect(JSON.stringify(await pane.drawn())).toContain('in a new conversation or after /clear')
  })
}

// ── Savings estimate ──

test('request pricing and saved output', () => {
  const u = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 2000 }
  // Opus 5.5: 1000×4 + 1000×20 + 100k×0.2 + 2000×8 (main conversation: one-hour write) = 60,000 / 1e6
  expect(near(stepCost(u, 'claude-opus-5-5', true), 0.06)).toBe(true)
  // a subagent on Sonnet: five-minute write
  expect(near(stepCost(u, 'claude-sonnet-5-5', false), (1000 * 2 + 1000 * 10 + 100_000 * 0.1 + 2000 * 2.5) / 1e6)).toBe(true)
  expect(near(savedOutput(800, 'medium', 'xhigh'), 800)).toBe(true)
  expect(savedOutput(800, 'high', 'high')).toBe(0)
})

test('calibration: cost between readings ↔ the rise, a drop of the window discards it', () => {
  let c = parseCalibration(undefined)
  c = calibrationReading(c, 10)
  c = calibrationReading(calibrationAddCost(c, 30), 11)
  c = calibrationReading(calibrationAddCost(c, 25), 11) // no rise: the cost waits
  c = calibrationReading(calibrationAddCost(c, 35), 13)
  expect(c).toMatchObject({ cost: 90, percent: 3, samples: 2, last: 13, accrued: 0 })
  expect(near(weekCost(c), 3000)).toBe(true)
  const drop = calibrationReading(calibrationAddCost(c, 50), 12)
  expect(drop).toMatchObject({ cost: 90, percent: 3, last: 12, accrued: 0 })
  // $30 saved with a $3000 week = 1% of the calibrated plan's week
  expect(near(weekPercent(30, c), 1)).toBe(true)
  expect(weekPercent(30, parseCalibration(undefined))).toBeNull()
  // calibration stored before 0.10
  expect(parseCalibration({ koszt: 90, procent: 3, pomiary: 2, ostatni: 13, narosle: 0 })).toEqual(c)
})

test('stats view: effort ranges from raw data, signed subagents, share of the week', () => {
  const c = { cost: 90, percent: 3, samples: 2, last: 13, accrued: 0 }
  // 10,000 output tokens at medium instead of xhigh: savings 0.5–1.5 × 10,000
  const ef = effortSavings({ 'claude-opus-5-5|xhigh>medium': 10_000 })
  expect(near(ef.tokens.lo, 5000)).toBe(true)
  expect(near(ef.tokens.hi, 15_000)).toBe(true)
  expect(near(ef.usd.lo, 0.1)).toBe(true)
  const st = {
    ...emptyStats('2026-10-29'),
    steps: { medium: { n: 30, out: 24_000 }, xhigh: { n: 10, out: 20_000 } },
    lowered: 30,
    lowerings: { 'claude-opus-5-5|xhigh>medium': 10_000 },
    subCost: 3,
    subBaseline: 1,
    subagents: { 'haiku/low': 5, 'sonnet/medium': 2 },
  }
  const v = statsView(st, c)
  expect(v.steps).toBe(40)
  expect(v.levels.map(x => x.level)).toEqual(['medium', 'xhigh'])
  expect(v.sub && near(v.sub.usd, -2)).toBe(true)
  expect(v.subagents[0]).toEqual({ key: 'haiku/low', n: 5 })
  // total: 0.1–0.3 − 2 = −1.9…−1.7 → with a $3000 week about −0.063…−0.057%
  expect(v.week && near(v.week.usd, 3000)).toBe(true)
  expect(v.week && v.week.percent.lo < 0).toBe(true)
  expect(statsView(st, parseCalibration(undefined)).week).toBeNull()
})

test('in a session: steps with usage count savings, weekly readings calibrate, the pane shows the share', async ($, on) => {
  const mem: Record<string, unknown> = { 'economy:/p': ON }
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  on('tool.call', async () => ({ result: {} as never }))
  on('ui.open', () => ({ value: undefined as never }))
  await $.session.start({ cwd: '/p' } as never)
  const measureWeek = (p: number) =>
    $.session.measure({
      context: { tokens: 10_000, window: 200_000, percent: 5 },
      rateLimits: [{ kind: 'seven_day', percentUsed: p }],
      changed: ['context', 'rateLimits'],
    } as never)
  await measureWeek(20)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'simple' } as never)
  for (let i = 0; i < 10; i++) await step($ as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await measureWeek(25)
  const st = mem['economy-stats:/p'] as { lowered: number; savedOutput: number }
  // xhigh→medium: every step with 500 output tokens saved about 500 (factor 2×)
  expect(st.lowered).toBe(10)
  expect(near(st.savedOutput, 5000)).toBe(true)
  expect(mem['economy-calibration:x20']).toMatchObject({ percent: 5, samples: 1 })

  await $.command.run({ command: 'kokpit', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'kokpit', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-panel' })
  await pane.press({ key: 'tab-stats' })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Savings on Max x20')
  expect(drawn).toContain('of the weekly limit')
  expect(drawn).toContain('fewer output tokens')
  await pane.press({ key: 'eco-plan-pro' })
  expect(mem['economy-plan']).toBe('pro')
  // a separate calibration for Pro: none yet
  expect(JSON.stringify(await pane.drawn())).toContain('after calibration')
  await pane.press({ key: 'tab-handoff' })
  const h = JSON.stringify(await pane.drawn())
  expect(h).toContain('Thresholds')
  expect(h).toContain('Decision register')
})

test('fixed xhigh ceiling: a session at medium, hard goes higher, simple stays at medium', async ($, on) => {
  const mem: Record<string, unknown> = { 'economy:/p': { split: false, effort: true, floor: 'medium', ceiling: 'xhigh' } }
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  on('tool.call', async () => ({ result: {} as never }))
  await $.session.start({ cwd: '/p' } as never)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await step($ as never, OPUS, 'medium')
  await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'hard' } as never)
  await step($ as never, OPUS, 'medium')
  await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'simple' } as never)
  await step($ as never, OPUS, 'medium')
  expect(sent.map(x => x.effort)).toEqual(['xhigh', 'xhigh', 'medium'])
})

test('worktree: settings and stats shared by the project (the root above the common .git)', async ($, on) => {
  const mem: Record<string, unknown> = { 'economy:/repo': ON }
  const sent: { effort?: unknown; model: string }[] = []
  on('process.run', (_$, e) => ({
    value: {
      exitCode: e.argv.includes('--git-common-dir') ? 0 : 1,
      stdout: e.argv.includes('--git-common-dir') ? '/repo/.git\n' : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  engine(on, mem, sent, '/repo/.claude/worktrees/feature-x')
  on('tool.call', async () => ({ result: {} as never }))
  await $.session.start({ cwd: '/repo/.claude/worktrees/feature-x' } as never)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__kokpit__effort_rating', rating: 'simple' } as never)
  await step($ as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(sent.map(x => x.effort)).toEqual(['medium'])
  expect(mem['economy-stats:/repo']).toBeDefined()
})

// ── Local model ──

test('model list from ollama list, and the commands', () => {
  const out = 'NAME                    ID              SIZE     MODIFIED\nglm-4.7-flash:latest    4475827791a2    19 GB    4 days ago\nqwen3:8b    abc    5 GB    1 week ago\n'
  expect(parseOllamaList(out)).toEqual(['glm-4.7-flash:latest', 'qwen3:8b'])
  expect(localTextCmd('glm-4.7-flash:latest', "/p/x's.md")).toBe("ollama run 'glm-4.7-flash:latest' < '/p/x'\\''s.md'")
  const code = localCodeCmd('/p', '20261024T1000-code', 'glm-4.7-flash:latest', '/p/z.md')
  expect(code).toContain("worktree add -q -b 'kokpit-local/20261024T1000-code'")
  expect(code).toContain("opencode run -m 'ollama/glm-4.7-flash:latest'")
  expect(code).toContain('git diff --cached HEAD >')
})

test('local model: the tool hands the task off in the background, the result comes back to Claude', async ($, on) => {
  const mem: Record<string, unknown> = {
    'economy:/p': { split: false, effort: false, floor: 'medium', ceiling: 'xhigh', local: true, localModel: 'glm-4.7-flash:latest' },
  }
  const sent: { effort?: unknown; model: string }[] = []
  const files: Record<string, string> = {}
  let argv: readonly string[] = []
  on('process.run', (_$, e) => ({
    value: { exitCode: e.argv.join(' ').includes('opencode') ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('env.get', () => ({ value: undefined }))
  const submitted: string[] = []
  on('prompt.submit', async (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('process.spawn', async function* (_$, e) {
    argv = e.argv
    yield { stream: 'stdout' as const, text: 'Summary: 3 tests timed out.\n' }
    return { value: { code: 0, signal: null } }
  })
  const clk = engine(on, mem, sent)
  on('tool.call', async () => ({ result: {} as never }))
  on('prompt.compose', async () => ({ sections: [] }))
  await $.session.start({ cwd: '/p' } as never)
  const composed = JSON.stringify(await $.prompt.compose(COMPOSE))
  expect(composed).toContain('local model glm-4.7-flash:latest')
  expect(composed).toContain('unavailable (no opencode')

  const code = await $.tool.call({ tool: 'mcp__kokpit__local_model', mode: 'code', task: 'change X' } as never)
  expect(String((code as { result?: unknown }).result)).toContain('unavailable')

  const r = await $.tool.call({ tool: 'mcp__kokpit__local_model', mode: 'text', task: 'Summarize the test log', label: 'Log summary' } as never)
  expect(String((r as { result?: unknown }).result)).toContain('Handed to glm-4.7-flash:latest')
  expect(Object.values(files)).toContain('Summarize the test log')
  await clk.advance(2000)
  expect(argv.join(' ')).toContain("ollama run 'glm-4.7-flash:latest'")
  expect(submitted.join('\n')).toContain('3 tests timed out')
})

test('subagent: a tool failure raises its effort one level, other subagents unchanged', async ($, on) => {
  const mem: Record<string, unknown> = { 'economy:/p': { split: true, effort: false, floor: 'medium', ceiling: 'xhigh' } }
  const sent: { effort?: unknown; model: string }[] = []
  engine(on, mem, sent)
  on('tool.call', async () => ({ result: 'no such file', isError: true }) as never)
  await $.session.start({ cwd: '/p' } as never)
  const agentStep = async (agentId: string) => {
    const s = $.turn.step({ turnId: 'a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 2, agentId } as never)
    for await (const _ of s) {
      // no chunks
    }
    await s.result
  }
  await agentStep('e1')
  await $.tool.call({ tool: 'Read', file_path: '/p/x', agentId: 'e1' } as never)
  await agentStep('e1')
  await agentStep('e2')
  expect(sent.map(x => x.effort)).toEqual(['low', 'medium', 'low'])
})

test('Haiku roles: reporter and mechanic registered with split on, Haiku only in them and in Explore', async ($, on) => {
  expect(subagentModel('haiku', 'kokpit:mechanic')).toBe('haiku')
  expect(subagentModel('haiku', 'kokpit:reporter')).toBe('haiku')
  expect(subagentModel('haiku', 'Plan')).toBe('sonnet')
  expect(subagentEffort(undefined, 'kokpit:reporter')).toBe('low')
  expect(subagentEffort(undefined, 'kokpit:mechanic')).toBe('medium')

  const mem: Record<string, unknown> = { 'economy:/p': { split: true, effort: false, floor: 'medium', ceiling: 'xhigh' } }
  const registered: { name: string; model?: string; tools?: readonly string[]; prompt: string }[] = []
  on('agent.register', (_$, e) => {
    registered.push(e as never)
    return { value: { agent: 'kokpit:' + (e as { name: string }).name } as never }
  })
  engine(on, mem, [])
  on('tool.call', async () => ({ result: {} as never }))
  await $.session.start({ cwd: '/p' } as never)
  expect(registered.map(a => a.name)).toEqual(['reporter', 'mechanic'])
  expect(registered.every(a => a.model === 'haiku')).toBe(true)
  expect(registered[0]?.tools).not.toContain('Edit')
  expect(registered[1]?.prompt).toContain('ABORTED')
})
