import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hiddenSkills, parseShare, withSkill } from '../hooks/tools'
import {
  addTask,
  answersMarkdown,
  applyPlan,
  autoDue,
  bar,
  busyLabels,
  endsWithQuestion,
  hardThresholdFor,
  housekeepingNote,
  isDue,
  isFinished,
  isHandoffPath,
  isFresh,
  isThreadFile,
  orphanKeys,
  pickSaved,
  previousContext,
  progress,
  resetLabel,
  setStatus,
  stats,
  thresholdFor,
} from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 12, contentRows: 2 },
  view: 'main',
} as never

const H0 = {
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
}

/** A reading as from the engine: `tokens` of context in a 200k window. */
const measure = (tokens: number) => ({
  context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 31, resetsAt: '2026-10-13T14:20:00Z' },
    { kind: 'seven_day', percentUsed: 12.5, resetsAt: '2026-10-17T09:00:00Z' },
  ],
  changed: ['context', 'rateLimits'] as ('context' | 'rateLimits')[],
})

const TURN_END = { answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const }

type Ran = { command: string; args: string }[]

/** The plugin store in memory, so a test can seed and read it. */
function memoryStore(on: On, mem: Record<string, unknown>) {
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
}

/** Conversation window id in the tests (= session id from `engine`) and this window's /clear bridge key. */
const OWNER = 'session-1'
const flow = (name: string) => `${name}:${OWNER}`
const NOW = Date.parse('2026-10-13T10:00:00Z')

/** What the engine does under the plugins in a session: measure, commands, tools, clock, store. */
function engine(on: On, ran: Ran, mem: Record<string, unknown> = {}, cwd = '/p') {
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: '/p' }))
  on('session.id', () => ({ value: OWNER }))
  on('command.run', async (_$, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('turn.complete', async () => ({ text: '' }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('prompt.attachment', async () => ({ text: '' }))
  on('skill.prompt', async (_$, e) => ({ text: e.text }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: e.subject, subject: e.subject } } }
    return { result: {} as never }
  })
  memoryStore(on, mem)
  return mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
}

// ── Pure functions ──

test('token threshold, but never beyond 75% of the window', () => {
  expect(thresholdFor(150_000, 200_000)).toBe(150_000)
  expect(thresholdFor(150_000, 1_000_000)).toBe(150_000)
  expect(thresholdFor(150_000, 100_000)).toBe(75_000)
})

test('time for a handoff: threshold, snooze, distance from the previous one', () => {
  expect(isDue(149_000, 150_000, H0)).toBe(false)
  expect(isDue(150_000, 150_000, H0)).toBe(true)
  expect(isDue(160_000, 150_000, { ...H0, snoozedUntil: 180_000 })).toBe(false)
  expect(isDue(160_000, 150_000, { ...H0, running: true })).toBe(false)
  expect(isDue(170_000, 150_000, { ...H0, lastTokens: 155_000 })).toBe(false)
  expect(isDue(186_000, 150_000, { ...H0, lastTokens: 155_000 })).toBe(true)
  expect(isDue(null, 150_000, H0)).toBe(false)
})

test('task finished: the whole list checked off, or no list', () => {
  expect(isFinished([])).toBe(true)
  expect(isFinished([{ id: '1', subject: 'a', status: 'completed' }])).toBe(true)
  expect(isFinished([{ id: '1', subject: 'a', status: 'completed' }, { id: '2', subject: 'b', status: 'pending' }])).toBe(false)
  expect(isFinished([{ id: '1', subject: 'a', status: 'in_progress' }])).toBe(false)
})

test('hard threshold: soft + 100k, never beyond 85% of the window, never below the soft one', () => {
  expect(hardThresholdFor(200_000, 0, 1_000_000)).toBe(300_000)
  expect(hardThresholdFor(150_000, 0, 200_000)).toBe(170_000)
  expect(hardThresholdFor(200_000, 260_000, 1_000_000)).toBe(260_000)
  expect(hardThresholdFor(200_000, 100_000, 1_000_000)).toBe(200_000)
})

test('automatic handoff: one per conversation, soft after a finished task, hard always', () => {
  expect(autoDue(210_000, 200_000, 300_000, H0, true)).toBe(true)
  expect(autoDue(210_000, 200_000, 300_000, H0, false)).toBe(false)
  expect(autoDue(310_000, 200_000, 300_000, H0, false)).toBe(true)
  expect(autoDue(190_000, 200_000, 300_000, H0, true)).toBe(false)
  expect(autoDue(400_000, 200_000, 300_000, { ...H0, lastTokens: 210_000 }, true)).toBe(false)
  expect(autoDue(310_000, 200_000, 300_000, { ...H0, snoozedUntil: 340_000 }, true)).toBe(false)
  expect(autoDue(310_000, 200_000, 300_000, { ...H0, running: true }, true)).toBe(false)
  expect(autoDue(null, 200_000, 300_000, H0, true)).toBe(false)
})

test('an answer ending with a question', () => {
  expect(endsWithQuestion('Done.\n\nShall I do both parts?')).toBe(true)
  expect(endsWithQuestion('**Shall I?**')).toBe(true)
  expect(endsWithQuestion('Does it work? Yes.\nDone.')).toBe(false)
  expect(endsWithQuestion('')).toBe(false)
})

test('app task list: new list, advance, done, start', () => {
  const items = [
    { content: 'A', status: 'in_progress' },
    { content: 'B', status: 'pending' },
    { content: 'C', status: 'pending' },
  ]
  const list = applyPlan([], { items })
  expect(list.map(t => t.status)).toEqual(['in_progress', 'pending', 'pending'])
  const advanced = applyPlan(list, { advance: true })
  expect(advanced.map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  const jumped = applyPlan(advanced, { done: [2], start: 3 })
  expect(jumped.map(t => t.status)).toEqual(['completed', 'completed', 'in_progress'])
  expect(applyPlan(jumped, { advance: true }).every(t => t.status === 'completed')).toBe(true)
  expect(applyPlan([], { items: [{ content: 'X', status: 'weird' }] })[0]?.status).toBe('pending')
})

test('the latest-answers file and the note for the new session', () => {
  const md = answersMarkdown(
    'thread',
    [
      { at: '2026-10-18T19:30:00.000Z', text: 'First' },
      { at: '2026-10-18T19:34:00.000Z', text: 'Shall I?' },
    ],
    '2026-10-18T19:35:00.000Z',
  )
  expect(md).toContain('# Latest answers before the conversation was cleared — thread')
  expect(md).toContain('## Answer 2 of 2 · 19:34')
  expect(md).toContain('Shall I?')
  expect(previousContext(md)).toContain('do point 2')
})

test('tools: share of code in the graph and skills hidden in the project settings', () => {
  expect(parseShare('  code in graph: 26% (threshold 60%)')).toBe(0.26)
  expect(parseShare('nothing')).toBeNull()
  const hidden = withSkill('{\n  "model": "opus"\n}', 'anthropic-skills:legal', true)
  expect(JSON.parse(hidden)).toEqual({
    model: 'opus',
    skillOverrides: { 'anthropic-skills:legal': 'user-invocable-only', legal: 'user-invocable-only' },
  })
  expect(hiddenSkills(JSON.parse(hidden).skillOverrides)).toEqual(['anthropic-skills:legal'])
  expect(JSON.parse(withSkill(hidden, 'anthropic-skills:legal', false))).toEqual({ model: 'opus' })
  expect(JSON.parse(withSkill(null, 'my-skill', true))).toEqual({ skillOverrides: { 'my-skill': 'user-invocable-only' } })
  expect(() => withSkill('{ broken', 'x', true)).toThrow()
})

test('an archive file is not a thread', () => {
  expect(isThreadFile('thread.md')).toBe(true)
  expect(isThreadFile('/p/.claude/handoffs/thread.md')).toBe(true)
  expect(isThreadFile('thread.archiwum.md')).toBe(false)
  expect(isThreadFile('/p/.claude/handoffs/thread.archiwum.md')).toBe(false)
  expect(isThreadFile('note.txt')).toBe(false)
})

test('background work: running agents, Kokpit jobs, commands without subagents', () => {
  const agents = [
    { status: 'running', description: 'audit', type: 'Explore' },
    { status: 'waiting', description: '', type: 'general-purpose' },
    { status: 'completed', description: 'old', type: 'Explore' },
    { status: 'idle', description: 'colleague', type: 'teammate' },
  ]
  const jobs = [
    { endedAt: null, label: 'tests camp' },
    { endedAt: 5, label: 'Benchmark' },
  ]
  const tasks = [
    { type: 'shell', description: 'npm run build' },
    { type: 'subagent', description: 'audit' },
  ]
  expect(busyLabels(agents, jobs, tasks)).toEqual(['audit', 'general-purpose', 'tests camp', 'npm run build'])
  expect(busyLabels([], [], [])).toEqual([])
  // a companion chat (nested or detached) does not block clearing
  expect(busyLabels([{ status: 'waiting', description: 'chat', type: 'teammate', teammateId: 'c@z' }], [], [])).toEqual([])
})

test('progress: completed + half for a task in progress', () => {
  const ts = [
    { id: '1', subject: 'a', status: 'completed' as const },
    { id: '2', subject: 'b', status: 'in_progress' as const },
    { id: '3', subject: 'c', status: 'pending' as const },
    { id: '4', subject: 'd', status: 'pending' as const },
  ]
  expect(progress(ts)).toEqual({ done: 1, total: 4, percent: 38, current: 'b' })
  expect(progress([])).toBeNull()
})

test('a new task after a completed list starts a new list', () => {
  const done = [{ id: '1', subject: 'a', status: 'completed' as const }]
  expect(addTask(done, { id: '2', subject: 'b', status: 'pending' })).toHaveLength(1)
  const open = setStatus(done, '1', 'in_progress')
  expect(addTask(open, { id: '2', subject: 'b', status: 'pending' })).toHaveLength(2)
  expect(setStatus(open, '1', 'deleted')).toHaveLength(0)
})

test('write permission only for a thread file in the project', () => {
  expect(isHandoffPath('/p/.claude/handoffs/abc.md', '/p')).toBe(true)
  expect(isHandoffPath('/p/.claude/handoffs/abc.md', '/p/')).toBe(true)
  expect(isHandoffPath('/p/.claude/handoffs/../settings.json', '/p')).toBe(false)
  expect(isHandoffPath('/p/.claude/handoffs/.previous/abc.md', '/p')).toBe(false)
  expect(isHandoffPath('/p/.claude/handoffs/abc.sh', '/p')).toBe(false)
  expect(isHandoffPath('/other/.claude/handoffs/abc.md', '/p')).toBe(false)
})

test('thread save: the newest file since the handoff started', () => {
  const t = 1_000_000
  const files = [
    { path: 'a.md', mtimeMs: t - 60_000 },
    { path: 'b.md', mtimeMs: t + 5_000 },
    { path: 'c.md', mtimeMs: t + 9_000 },
  ]
  expect(pickSaved(files, t)).toBe('c.md')
  expect(pickSaved(files.slice(0, 1), t)).toBeNull()
  expect(pickSaved([{ path: 'd.md', mtimeMs: t - 1_000 }], t)).toBe('d.md')
})

/** The thread directory: name → modification time. */
function threads(on: On, files: Record<string, number>) {
  on('fs.exists', () => ({ value: Object.keys(files).length > 0 }))
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: files[name] ?? 0 })) as never,
  }))
  on('fs.stat', (_$, e) => ({
    value: { kind: 'file' as const, size: 1, mtimeMs: files[e.path.split('/').pop() ?? ''] ?? 0 } as never,
  }))
}

test('handoff stats', () => {
  const now = Date.parse('2026-10-13T10:00:00Z')
  const log = [
    { at: '2026-10-13T09:00:00Z', tokens: 150_000, thread: 'a', mode: 'break' as const },
    { at: '2026-10-12T09:00:00Z', tokens: 170_000, thread: 'b', mode: 'button' as const },
    { at: '2026-09-01T09:00:00Z', tokens: 99_000, thread: 'c', mode: 'auto' as const },
  ]
  expect(stats(log, now)).toBe(
    'Handoffs today: 1 · last 7 days: 2 in 2 threads · at 160k tokens on average · automatic: 1',
  )
  // a refresh before clearing is neither an automatic handoff nor a button press; old Polish modes still count
  const refreshed = [...log, { at: '2026-10-13T09:30:00Z', tokens: 130_000, thread: 'a', mode: 'dopisanie' as never }]
  expect(stats(refreshed, now)).toBe(
    'Handoffs today: 2 · last 7 days: 3 in 2 threads · at 150k tokens on average · automatic: 1 · refreshed on a message: 1',
  )
})

test('bar and reset time', () => {
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(resetLabel(null, false)).toBe('')
  expect(resetLabel('not-a-date', true)).toBe('')
})

// ── Behaviour in a session ──

test('"break" mode: past the threshold and with no task in progress the handoff starts by itself after the turn', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('"break" mode: nothing below the threshold', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(120_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('"break" mode: waits while a task is in progress, starts after it is completed', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Scene', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'Scene', status: 'in_progress' })
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran).toHaveLength(0)

  await $.tool.call({ tool: 'TaskUpdate', taskId: 'Scene', status: 'completed' })
  await $.turn.complete({ ...TURN_END, turnId: 't2' })
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('"button" mode: nothing starts by itself', { options: { handoffMode: 'button' } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(190_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('"auto" mode: starts despite a task in progress', { options: { handoffMode: 'auto' } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Scene', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'Scene', status: 'in_progress' })
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('threshold from the settings', { options: { handoffTokens: 100_000 } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(110_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('after /clear from "Clear and resume" Kokpit runs /resume for that thread by itself', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {
    [flow('pendingResume')]: '/p/.claude/handoffs/cutscene-plauen.md',
    [flow('pendingAt')]: NOW - 2_000,
  }
  const clock = engine(on, ran, mem)
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(ran).toEqual([{ command: 'kokpit:resume', args: 'cutscene-plauen' }])
  expect(mem[flow('pendingResume')]).toBeUndefined()
  expect(mem[flow('pendingAt')]).toBeUndefined()
})

test('/clear does not take the bridge of another window or an expired one', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {
    // a parallel session (another window, maybe another project) is clearing right now: not ours
    'pendingResume:session-2': '/other/.claude/handoffs/foreign.md',
    'pendingPrompt:session-2': 'message from another window',
    'pendingAt:session-2': NOW - 1_000,
    // ours, but from an hour ago (a failed clear)
    [flow('pendingResume')]: '/p/.claude/handoffs/old.md',
    [flow('pendingPrompt')]: 'long stale',
    [flow('pendingAt')]: NOW - 3_600_000,
  }
  const clock = engine(on, ran, mem)
  threads(on, {})
  const io = desk(on)
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(ran).toHaveLength(0)
  expect(io.submitted).toHaveLength(0)
  expect(mem[flow('pendingResume')]).toBeUndefined()
  expect(mem[flow('pendingPrompt')]).toBeUndefined()
  expect(mem['pendingPrompt:session-2']).toBe('message from another window')
})

test('session directory moved (cd in Bash): Kokpit files still from the project root', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  // after `cd .claude/handoffs` in Bash the session directory is there, the project root is still /p
  const clock = engine(on, ran, mem, '/p/.claude/handoffs')
  const files: Record<string, number> = {}
  const listed: string[] = []
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_$, e) => {
    listed.push(e.path)
    return { value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: files[name] ?? 0 })) as never }
  })
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: files[e.path.split('/').pop() ?? ''] ?? 0 } as never }))
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await $.session.measure(measure(60_000))
  await turn($, 't0', 'An answer to remember.')
  await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: 'go on', ...USER })
  await clock.settle()
  expect(r.drop).toBeDefined()
  expect(listed.every(p => p === '/p/.claude/handoffs')).toBe(true)
  expect(writes).toEqual(['/p/.claude/kokpit/previous/thread.md'])
  expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/thread.md')
  expect(mem[flow('pendingPrevious')]).toBe('/p/.claude/kokpit/previous/thread.md')
  expect(isHandoffPath('/p/.claude/handoffs/thread.md', '/p')).toBe(true)
})

test('bridge freshness and cleaning store leftovers', () => {
  expect(isFresh(NOW - 60_000, NOW)).toBe(true)
  expect(isFresh(NOW - 6 * 60_000, NOW)).toBe(false)
  expect(isFresh(undefined, NOW)).toBe(false)
  const store: Record<string, unknown> = {
    log: [],
    pendingContext: '.claude/kokpit/previous/x.md',
    pendingResume: '.claude/handoffs/x.md',
    'pendingPrompt:alive': 'in progress',
    'pendingAt:alive': NOW - 120_000,
    'pendingResume:dead': '/p/.claude/handoffs/y.md',
    'pendingAt:dead': NOW - 2 * 3_600_000,
    'pendingPrompt:no-time': 'orphan',
  }
  expect(orphanKeys(Object.keys(store), store, NOW).sort()).toEqual(
    ['pendingAt:dead', 'pendingContext', 'pendingPrompt:no-time', 'pendingResume', 'pendingResume:dead'].sort(),
  )
})

test('session start removes the old pendingContext key', async ($, on) => {
  const mem: Record<string, unknown> = { pendingContext: '.claude/kokpit/previous/push-volley.md', log: [] }
  engine(on, [], mem)
  threads(on, {})
  on('session.usage', () => ({ value: { context: { tokens: 1_000, window: 200_000, percent: 1 }, rateLimits: [] } as never }))
  on('session.turns', () => ({ value: 0 }))
  on('tool.register', () => ({ value: undefined as never }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', async () => ({ cwd: '/p' }))
  await $.session.start({ cwd: '/p' } as never)
  expect('pendingContext' in mem).toBe(false)
  expect(mem.log).toEqual([])
})

test('auto-compact gets an instruction not to blur decisions', async ($, on) => {
  let instructions = ''
  on('session.compact', async (_$, e) => {
    instructions = e.instructions ?? ''
    return { skip: 'test' }
  })
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'x', toolUses: [] }] as never })
  expect(instructions).toContain('verbatim')
})

for (const surface of SURFACES) {
  test(`${surface}: below the threshold only the meters`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('31%')
    expect(drawn).toContain('60k/200k')
    expect(await ui.find({ key: 'kokpit-handoff' })).toBeUndefined()
  })

  test(`${surface}: past the threshold "Now", the thread is saved, then "Clear and resume"`, async ($, on) => {
    const ran: Ran = []
    const mem: Record<string, unknown> = {}
    engine(on, ran, mem)
    await $.session.measure(measure(155_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    expect(JSON.stringify(await ui.drawn())).toContain('after the task is finished')

    await ui.press({ key: 'kokpit-handoff' })
    expect(ran[0]?.command).toBe('kokpit:handoff')
    expect(JSON.stringify(await ui.drawn())).toContain('Writing the handoff')

    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/terrain-mud.md', content: '# T' })
    expect(JSON.stringify(await ui.drawn())).toContain('terrain-mud')

    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran[1]?.command).toBe('clear')
    expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/terrain-mud.md')

    const log = mem.log as { thread: string; tokens: number }[]
    expect(log[0]).toMatchObject({ thread: 'terrain-mud', tokens: 155_000 })
  })

  test(`${surface}: a turn end without a save drops "Writing the handoff"`, async ($, on) => {
    engine(on, [])
    threads(on, { 'stary.md': Date.parse('2026-10-12T10:00:00Z') })
    await $.session.measure(measure(155_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'kokpit-handoff' })
    expect(JSON.stringify(await ui.drawn())).toContain('Writing the handoff')
    await $.turn.complete(TURN_END)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toContain('Writing the handoff')
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()
  })

  test(`${surface}: a manual /kokpit:handoff saved outside Write ends with "Clear and resume"`, async ($, on) => {
    engine(on, [])
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    expect(JSON.stringify(await ui.drawn())).toContain('Writing the handoff')
    files['tests-coverage.md'] = Date.parse('2026-10-13T10:00:30Z')
    await $.turn.complete(TURN_END)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toContain('Writing the handoff')
    expect(drawn).toContain('tests-coverage')
  })

  test(`${surface}: stale thread: "Clear and resume" refreshes the handoff first`, async ($, on) => {
    const ran: Ran = []
    const mem: Record<string, unknown> = {}
    const clock = engine(on, ran, mem)
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })

    // t1: handoff saved
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    expect(JSON.stringify(await ui.drawn())).toContain('✓ Thread \\"thread\\" saved')

    // t2: the conversation goes on → the save is stale
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    expect(JSON.stringify(await ui.drawn())).toContain('Refresh, clear and resume')

    // click: does not clear, only starts the handoff
    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])

    // t3: handoff refreshed → only now /clear
    await $.turn.start({ text: '', turnId: 't3' })
    files['thread.md'] = Date.parse('2026-10-13T10:00:20Z')
    await $.turn.complete({ ...TURN_END, turnId: 't3' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff', 'clear'])
    expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/thread.md')
  })

  test(`${surface}: a failed refresh does not clear the conversation`, async ($, on) => {
    const ran: Ran = []
    const clock = engine(on, ran)
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.turn.start({ text: '', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    await clock.advance(60_000)
    await ui.press({ key: 'kokpit-clear-resume' })
    await $.turn.start({ text: '', turnId: 't3' })
    await $.turn.complete({ ...TURN_END, turnId: 't3', isAborted: true })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
  })

  test(`${surface}: a manual /clear with a stale thread waits for the handoff`, async ($, on) => {
    const ran: Ran = []
    const clock = engine(on, ran)
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    await $.turn.start({ text: '', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    const out = await $.command.run({ command: 'clear', args: '', origin: { kind: 'composer' } } as never)
    expect(String((out as { text?: string }).text)).toContain('refreshing the handoff first')
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
  })

  test(`${surface}: plan mode: the handoff does not start, it waits for the exit`, async ($, on) => {
    const ran: Ran = []
    const clock = engine(on, ran)
    await $.session.measure(measure(160_000))
    await $.prompt.attachment({ type: 'plan_mode', text: '', detail: { reminder: 'full', planFilePath: '/x', hasPlan: false } } as never)
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.turn.complete(TURN_END)
    await clock.settle()
    expect(ran).toHaveLength(0)
    expect(JSON.stringify(await ui.drawn())).toContain('after plan mode ends')

    // a manual /kokpit:handoff in plan mode: a note instead of the skill, nothing is written
    const out = await $.skill.prompt({ skill: 'kokpit:handoff', text: 'FULL SKILL' })
    expect(out.text).toContain('plan mode')
    expect(JSON.stringify(await ui.drawn())).not.toContain('Writing the handoff')

    // leaving plan mode → a handoff at the next break
    await $.prompt.attachment({ type: 'plan_mode_exit', text: '', detail: { planFilePath: '/x', hasPlan: true } } as never)
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
  })

  test(`${surface}: background agents hold /clear`, async ($, on) => {
    const ran: Ran = []
    engine(on, ran)
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'audit', type: 'Explore', status: 'running' }] as never }))
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/x.md', content: '# X' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/x.md', content: '# X' })
    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran.map(r => r.command)).not.toContain('clear')
  })

  test(`${surface}: after the agents' results the thread is refreshed and only then /clear`, async ($, on) => {
    const ran: Ran = []
    const mem: Record<string, unknown> = {}
    const clock = engine(on, ran, mem)
    const files: Record<string, number> = {}
    threads(on, files)
    let agents = [{ id: 'a1', description: 'audit', type: 'Explore', status: 'running' }]
    on('agent.list', () => ({ value: agents as never }))
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })

    // t1: handoff saved, "Clear and resume" with a background agent → waits
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran.map(r => r.command)).not.toContain('clear')
    expect(JSON.stringify(await ui.drawn())).toContain('I will clear after the background results')

    // t2: the agent still works: nothing
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    await clock.settle()
    expect(ran).toHaveLength(0)

    // t3: the agent's result arrived, nothing works any more → refresh the thread first
    agents = []
    await $.turn.start({ text: '', turnId: 't3' })
    await $.turn.complete({ ...TURN_END, turnId: 't3' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])

    // t4: thread refreshed → /clear and resume
    await $.turn.start({ text: '', turnId: 't4' })
    files['thread.md'] = Date.parse('2026-10-13T10:00:30Z')
    await $.turn.complete({ ...TURN_END, turnId: 't4' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff', 'clear'])
    expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/thread.md')
  })

  test(`${surface}: "Later" snoozes by 30k tokens`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(155_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'kokpit-snooze' })
    expect(await ui.find({ key: 'kokpit-handoff' })).toBeUndefined()
    await $.session.measure(measure(186_000))
    expect(await ui.find({ key: 'kokpit-handoff' })).toBeDefined()
  })

  test(`${surface}: saving the thread's archive does not pose as saving the thread`, async ($, on) => {
    const ran: Ran = []
    engine(on, ran)
    const files: Record<string, number> = { 'thread.md': Date.parse('2026-10-13T09:00:00Z') }
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })

    // t1: the handoff only appended to the archive (a Write and the file on disk): the thread is not saved
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/thread.archiwum.md', content: '# A' })
    files['thread.archiwum.md'] = Date.parse('2026-10-13T10:00:10Z')
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()

    // t2: archive and thread saved: the thread is done, not the archive
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't2' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['thread.md'] = Date.parse('2026-10-13T10:00:20Z')
    files['thread.archiwum.md'] = Date.parse('2026-10-13T10:00:25Z')
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('✓ Thread \\"thread\\" saved')
    expect(drawn).not.toContain('thread.archiwum')
  })

  test(`${surface}: a thread save without a running handoff does not pose as a handoff`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(60_000))
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/x.md', content: '# X' })
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()
  })

  test(`${surface}: a thread write passes without a prompt, other writes do not`, async ($, on) => {
    engine(on, [])
    on('tool.check', () => ({ decision: 'ask' as const }))
    const ok = await $.tool.check({ tool: 'Edit', input: { file_path: '/p/.claude/handoffs/abc.md' } })
    const other = await $.tool.check({ tool: 'Write', input: { file_path: '/p/src/main.ts', content: '' } })
    expect(ok.decision).toBe('allow')
    expect(other.decision).toBe('ask')
  })

  test(`${surface}: the task list gives a percentage`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(10_000))
    await $.tool.call({ tool: 'TaskCreate', subject: 'Build', description: '' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Check', description: '' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'Build', status: 'completed' })
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('50%')
    expect(drawn).toContain('1/2')
  })
}

// ── A handoff without annoyance: app task list, question, hard threshold, one per conversation ──

const PLAN = 'mcp__ccd_turn__update_plan'
const WRAP = 'mcp__ccd_turn__wrap_up'
const USER = { wait: false, origin: { kind: 'composer' as const } }

/** The path from `.claude/`: the engine passes absolute paths to file operations. */
const rel = (path: string) => path.slice(Math.max(0, path.indexOf('.claude/')))

/** Text files, sent messages and opened panes, in memory. */
function desk(on: On) {
  const written: Record<string, string> = {}
  const submitted: string[] = []
  const opened: string[] = []
  on('fs.write', (_$, e) => {
    written[rel(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.read', (_$, e) => ({ value: written[rel(e.path)] ?? '' }))
  on('prompt.submit', async (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  return { written, submitted, opened }
}

/** A turn with an answer (turn.start → turn.complete), as in a session. */
async function turn($: Engine, id: string, answer = '') {
  await $.turn.start({ text: '', turnId: id })
  await $.turn.complete({ ...TURN_END, turnId: id, answer })
}

test('break: an app task list in progress waits, after wrap_up it starts', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: 'commit and merge', turnId: 't1' })
  await $.tool.call({
    tool: PLAN,
    tool_use_id: 'u1',
    items: [
      { content: 'Commit', status: 'in_progress' },
      { content: 'Merge', status: 'pending' },
    ],
  })
  await $.turn.complete({ ...TURN_END, turnId: 't1', answer: 'Waiting for CI.' })
  await clock.settle()
  expect(ran).toHaveLength(0)

  await $.turn.start({ text: '', turnId: 't2' })
  await $.tool.call({ tool: WRAP, tool_use_id: 'u2', recap: 'Merged.' })
  await $.turn.complete({ ...TURN_END, turnId: 't2', answer: 'Merged into master.' })
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('a question to the user holds the soft threshold, the answer releases it', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.tool.call({ tool: WRAP, tool_use_id: 'u1', recap: 'Design ready.', ask: 'Apply the fixes?' })
  await $.turn.complete({ ...TURN_END, turnId: 't1', answer: 'Design A–F.' })
  await clock.settle()
  expect(ran).toHaveLength(0)

  await turn($, 't2', 'Shall I do both parts, or a handoff first?')
  await clock.settle()
  expect(ran).toHaveLength(0)

  await turn($, 't3', 'Done.')
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('hard threshold: a handoff despite work in progress and a question', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(175_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.tool.call({ tool: PLAN, tool_use_id: 'u1', items: [{ content: 'Long work', status: 'in_progress' }] })
  await $.turn.complete({ ...TURN_END, turnId: 't1', answer: 'Go on?' })
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('after a saved handoff a second one does not start by itself (no spam)', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })

  // background notifications fill the context: further turns without a new handoff
  await $.session.measure(measure(168_000))
  await turn($, 't2', 'Tests passed.')
  await turn($, 't3', 'Benchmark finished.')
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('a message after the save: answers to a file, /clear, resume and the same message in the new session', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  const clock = engine(on, ran, mem)
  const files: Record<string, number> = {}
  threads(on, files)
  const io = desk(on)
  const session = mock.session(on)
  on('classic.SessionStart', async () => ({}))
  await $.session.measure(measure(60_000))

  await turn($, 't1', 'First answer.')
  await turn($, 't2', 'Design A–F. Shall I?')
  await $.turn.start({ text: '/kokpit:handoff', turnId: 't3' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't3', answer: 'Thread saved.' })

  const r = await $.prompt.submit({ text: 'yes, both', ...USER })
  expect(String(r.drop)).toContain('clearing the conversation')
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['clear'])
  expect(mem[flow('pendingPrompt')]).toBe('yes, both')
  const saved = io.written['.claude/kokpit/previous/thread.md'] ?? ''
  expect(saved).toContain('First answer.')
  expect(saved).toContain('Design A–F. Shall I?')
  expect(saved).not.toContain('Thread saved.')

  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(ran).toEqual([
    { command: 'clear', args: '' },
    { command: 'kokpit:resume', args: 'thread after-clear' },
  ])
  expect(io.submitted).toEqual(['yes, both'])
  expect(mem[flow('pendingPrompt')]).toBeUndefined()
  expect(JSON.stringify(session.appended())).toContain('Design A–F. Shall I?')
  expect(io.opened).toContain('kokpit-previous')
})

test('a message after the conversation moved on: toast, refresh logged as "refresh", then /clear', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  const clock = engine(on, ran, mem)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await turn($, 't2', 'The conversation moved on.')

  const r = await $.prompt.submit({ text: 'the sleep is over', ...USER })
  expect(String(r.drop)).toContain('not an error')
  expect(String(r.drop)).toContain('refreshing the thread "thread"')
  expect(toasts).toEqual([String(r.drop)])
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['kokpit:handoff'])

  await $.turn.start({ text: '/kokpit:handoff', turnId: 't3' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:20Z')
  await $.turn.complete({ ...TURN_END, turnId: 't3' })
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['kokpit:handoff', 'clear'])
  expect(mem[flow('pendingPrompt')]).toBe('the sleep is over')
  const log = mem.log as { mode: string }[]
  expect(log.map(l => l.mode)).toEqual(['button', 'refresh'])
})

test('a message during a handoff waits and after the save goes to the new session', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  const clock = engine(on, ran, mem)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  const r = await $.prompt.submit({ text: 'I was going to answer', ...USER, turnId: 't1' })
  expect(String(r.drop)).toContain('finishing the handoff')
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['clear'])
  expect(mem[flow('pendingPrompt')]).toBe('I was going to answer')
})

test('a failed handoff gives the held message back to this conversation', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  const clock = engine(on, ran, mem)
  threads(on, {})
  const io = desk(on)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  await $.prompt.submit({ text: 'answer', ...USER, turnId: 't1' })
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await clock.settle()
  expect(ran.map(x => x.command)).not.toContain('clear')
  expect(io.submitted).toEqual(['answer'])
  expect(mem[flow('pendingPrompt')]).toBeUndefined()
})

test('background work: the message stays in this conversation, no clearing', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'audit', type: 'Explore', status: 'running' }] as never }))
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: 'go on', ...USER })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('clearing by button: a message after the save passes', { options: { handoffClear: 'button' } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: 'go on', ...USER })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('a message during another turn passes: /clear would interrupt it', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await $.turn.start({ text: 'background notification', turnId: 't2' })
  const r = await $.prompt.submit({ text: 'and also', ...USER, turnId: 't2' })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('a command after the save is not held', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['thread.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: '/decisions', ...USER, command: { name: 'decisions', args: '' } })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

for (const surface of SURFACES) {
  test(`${surface}: after clearing, "Previous answers" in the band and in the pane`, async ($, on) => {
    const mem: Record<string, unknown> = {
      [flow('pendingPrevious')]: '/p/.claude/kokpit/previous/thread.md',
      [flow('pendingAt')]: NOW - 1_000,
    }
    const clock = engine(on, [], mem)
    threads(on, {})
    const io = desk(on)
    io.written['.claude/kokpit/previous/thread.md'] = '# Latest answers\n\nDesign A–F. Shall I?'
    on('classic.SessionStart', async () => ({}))
    await $.classic.SessionStart({ source: 'clear' })
    await clock.settle()
    await $.session.measure(measure(10_000))
    const bar = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    expect(await bar.find({ key: 'kokpit-previous' })).toBeDefined()
    const pane = await $.ui.mount({
      plugin: 'kokpit',
      surface,
      component: 'Pane',
      props: {
        title: 'Previous answers',
        isFocused: true,
        bodyColumns: 120,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
        view: 'main',
      } as never,
      requestId: 'kokpit-previous',
    })
    expect(JSON.stringify(await pane.drawn())).toContain('Design A–F. Shall I?')
  })
}

for (const surface of SURFACES) {
  test(`${surface}: /tools: graphify does not fit, hiding a skill writes the project settings`, async ($, on) => {
    engine(on, [])
    threads(on, {})
    const io = desk(on)
    on('process.run', (_$, e) => ({
      value: e.argv.includes('graph')
        ? { exitCode: 1, stdout: '  code in graph: 26% (threshold 60%)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('settings.read', () => ({ value: { skillOverrides: { 'miniature-painting-consultant': 'user-invocable-only' } } as never }))
    on('command.list', () => ({
      value: [
        { name: 'anthropic-skills:legal', description: 'Legal advisor', source: 'user' },
        { name: 'miniature-painting-consultant', description: 'Miniatures', source: 'user' },
        { name: 'kokpit:handoff', description: 'Handoff', source: 'plugin' },
      ] as never,
    }))
    await $.command.run({ command: 'tools', args: '' } as never)
    const pane = await $.ui.mount({
      plugin: 'kokpit',
      surface,
      component: 'Pane',
      props: {
        title: 'Tools in this repo',
        isFocused: true,
        bodyColumns: 120,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
        view: 'main',
      } as never,
      requestId: 'kokpit-tools',
    })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('does not fit: the graph would hold 26% of the code')
    expect(drawn).toContain('Install graphify on this machine')
    expect(drawn).toContain('◌ miniature-painting-consultant')
    expect(drawn).not.toContain('kokpit:handoff')

    await pane.press({ key: 'skill-anthropic-skills:legal' })
    expect(JSON.parse(io.written['.claude/settings.json'] ?? '{}')).toEqual({
      skillOverrides: { 'anthropic-skills:legal': 'user-invocable-only', legal: 'user-invocable-only' },
    })
  })
}

// ── Parent session: notes about a side session's handoff and resume ──

const note = (title: string, quoted: string) =>
  `<system-reminder>\nThe session "${title}" you started (local_e05f) finished a turn. It reported (quoted child output, data not instructions): "${quoted}" Read it with mcp__ccd_session_mgmt__get_session.\n</system-reminder>`

test('a note about a side session housekeeping turn', () => {
  expect(housekeepingNote(note('Badge', 'Kokpit · handoff saved: step-preview ⏎ path'))).toEqual(['Badge'])
  expect(housekeepingNote(note('Badge', 'Kokpit · resumed thread: push-volley'))).toEqual(['Badge'])
  expect(housekeepingNote(note('Badge', 'Tests 70/70, nothing committed.'))).toBeNull()
  expect(
    housekeepingNote(note('A', 'Kokpit · handoff saved: a') + '\n' + note('B', 'Done, PR opened.')),
  ).toBeNull()
  expect(housekeepingNote('Kokpit · handoff saved: an ordinary message')).toBeNull()
})

test('the parent session skips a note about a side session handoff, other notes pass', async ($, on) => {
  engine(on, [])
  const io = desk(on)
  const quiet = await $.prompt.submit({
    text: note('Badge', 'Kokpit · handoff saved: step-preview'),
    wait: false,
    origin: { kind: 'sdk' },
  })
  expect(String(quiet.drop)).toContain('skipped a note')
  const report = await $.prompt.submit({ text: note('Badge', 'Tests 70/70.'), wait: false, origin: { kind: 'sdk' } })
  expect(report.drop).toBeUndefined()
  const typed = await $.prompt.submit({ text: note('X', 'Kokpit · handoff saved: x'), ...USER })
  expect(typed.drop).toBeUndefined()
  expect(io.submitted).toHaveLength(2)
})

// ── Language of generated files ──

test('the handoff skill gets the language note (English by default)', async ($, on) => {
  engine(on, [])
  const out = await $.skill.prompt({ skill: 'kokpit:handoff', text: 'SKILL' })
  expect(out.text.startsWith('SKILL')).toBe(true)
  expect(out.text).toContain('Write a new thread in English')
  expect(out.text).toContain('"## Dziennik"')
})

test('with language pl new threads, the register and templates are Polish', { options: { language: 'pl' } }, async ($, on) => {
  engine(on, [])
  const handoff = await $.skill.prompt({ skill: 'kokpit:handoff', text: 'SKILL' })
  expect(handoff.text).toContain('Kokpit is set to Polish')
  expect(handoff.text).toContain('"## Próbowaliśmy i odpadło"')
  const setup = await $.skill.prompt({ skill: 'kokpit:setup', text: 'SETUP' })
  expect(setup.text).toContain('--lang pl')
})
