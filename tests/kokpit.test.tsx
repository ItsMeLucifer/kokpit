import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  addTask,
  bar,
  busyLabels,
  isBreak,
  isDue,
  isHandoffPath,
  isThreadFile,
  pickSaved,
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
}

/** Odczyt jak z silnika: `tokens` kontekstu w oknie 200k. */
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

/** Magazyn pluginu w pamięci, żeby test mógł go zasiać i odczytać. */
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
}

/** To, co w sesji robi silnik pod pluginami: pomiar, polecenia, narzędzia, zegar, magazyn. */
function engine(on: On, ran: Ran, mem: Record<string, unknown> = {}) {
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: '/p' }))
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

// ── Czyste funkcje ──

test('próg w tokenach, ale nie dalej niż 75% okna', () => {
  expect(thresholdFor(150_000, 200_000)).toBe(150_000)
  expect(thresholdFor(150_000, 1_000_000)).toBe(150_000)
  expect(thresholdFor(150_000, 100_000)).toBe(75_000)
})

test('pora na handoff: próg, odłożenie, odstęp od poprzedniego', () => {
  expect(isDue(149_000, 150_000, H0)).toBe(false)
  expect(isDue(150_000, 150_000, H0)).toBe(true)
  expect(isDue(160_000, 150_000, { ...H0, snoozedUntil: 180_000 })).toBe(false)
  expect(isDue(160_000, 150_000, { ...H0, running: true })).toBe(false)
  expect(isDue(170_000, 150_000, { ...H0, lastTokens: 155_000 })).toBe(false)
  expect(isDue(186_000, 150_000, { ...H0, lastTokens: 155_000 })).toBe(true)
  expect(isDue(null, 150_000, H0)).toBe(false)
})

test('przerwa: nic w toku albo coś ukończone w tej turze', () => {
  const working = [{ id: '1', subject: 'a', status: 'in_progress' as const }]
  expect(isBreak([], false)).toBe(true)
  expect(isBreak(working, false)).toBe(false)
  expect(isBreak(working, true)).toBe(true)
})

test('plik archiwum nie jest wątkiem', () => {
  expect(isThreadFile('watek.md')).toBe(true)
  expect(isThreadFile('/p/.claude/handoffs/watek.md')).toBe(true)
  expect(isThreadFile('watek.archiwum.md')).toBe(false)
  expect(isThreadFile('/p/.claude/handoffs/watek.archiwum.md')).toBe(false)
  expect(isThreadFile('notatka.txt')).toBe(false)
})

test('praca w tle: agenty w toku, zadania Kokpitu, komendy bez subagentów', () => {
  const agents = [
    { status: 'running', description: 'audyt', type: 'Explore' },
    { status: 'waiting', description: '', type: 'general-purpose' },
    { status: 'completed', description: 'stary', type: 'Explore' },
    { status: 'idle', description: 'kolega', type: 'teammate' },
  ]
  const jobs = [
    { endedAt: null, label: 'testy camp' },
    { endedAt: 5, label: 'Probierz' },
  ]
  const tasks = [
    { type: 'shell', description: 'npm run build' },
    { type: 'subagent', description: 'audyt' },
  ]
  expect(busyLabels(agents, jobs, tasks)).toEqual(['audyt', 'general-purpose', 'testy camp', 'npm run build'])
  expect(busyLabels([], [], [])).toEqual([])
})

test('postęp: ukończone + pół za zadanie w toku', () => {
  const ts = [
    { id: '1', subject: 'a', status: 'completed' as const },
    { id: '2', subject: 'b', status: 'in_progress' as const },
    { id: '3', subject: 'c', status: 'pending' as const },
    { id: '4', subject: 'd', status: 'pending' as const },
  ]
  expect(progress(ts)).toEqual({ done: 1, total: 4, percent: 38, current: 'b' })
  expect(progress([])).toBeNull()
})

test('nowe zadanie po ukończonej liście zaczyna nową listę', () => {
  const done = [{ id: '1', subject: 'a', status: 'completed' as const }]
  expect(addTask(done, { id: '2', subject: 'b', status: 'pending' })).toHaveLength(1)
  const open = setStatus(done, '1', 'in_progress')
  expect(addTask(open, { id: '2', subject: 'b', status: 'pending' })).toHaveLength(2)
  expect(setStatus(open, '1', 'deleted')).toHaveLength(0)
})

test('zgoda na zapis tylko dla pliku wątku w projekcie', () => {
  expect(isHandoffPath('/p/.claude/handoffs/abc.md', '/p')).toBe(true)
  expect(isHandoffPath('/p/.claude/handoffs/abc.md', '/p/')).toBe(true)
  expect(isHandoffPath('/p/.claude/handoffs/../settings.json', '/p')).toBe(false)
  expect(isHandoffPath('/p/.claude/handoffs/.poprzednie/abc.md', '/p')).toBe(false)
  expect(isHandoffPath('/p/.claude/handoffs/abc.sh', '/p')).toBe(false)
  expect(isHandoffPath('/inny/.claude/handoffs/abc.md', '/p')).toBe(false)
})

test('zapis wątku: najświeższy plik od startu handoffu', () => {
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

/** Katalog wątków: nazwa → czas modyfikacji. */
function threads(on: On, files: Record<string, number>) {
  on('fs.exists', () => ({ value: Object.keys(files).length > 0 }))
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: files[name] ?? 0 })) as never,
  }))
  on('fs.stat', (_$, e) => ({
    value: { kind: 'file' as const, size: 1, mtimeMs: files[e.path.split('/').pop() ?? ''] ?? 0 } as never,
  }))
}

test('statystyki handoffów', () => {
  const now = Date.parse('2026-10-13T10:00:00Z')
  const log = [
    { at: '2026-10-13T09:00:00Z', tokens: 150_000, thread: 'a', mode: 'przerwa' as const },
    { at: '2026-10-12T09:00:00Z', tokens: 170_000, thread: 'b', mode: 'przycisk' as const },
    { at: '2026-09-01T09:00:00Z', tokens: 99_000, thread: 'c', mode: 'auto' as const },
  ]
  expect(stats(log, now)).toBe(
    'Handoffy dziś: 1 · ostatnie 7 dni: 2 w 2 wątkach · średnio przy 160k tokenów · automatycznych: 1',
  )
})

test('pasek i godzina resetu', () => {
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(resetLabel(null, false)).toBe('')
  expect(resetLabel('nie-data', true)).toBe('')
})

// ── Zachowanie w sesji ──

test('tryb „przerwa”: po progu i bez zadania w toku handoff rusza sam po turze', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('tryb „przerwa”: poniżej progu nic', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(120_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('tryb „przerwa”: z zadaniem w toku czeka, rusza po jego ukończeniu', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Scena', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'Scena', status: 'in_progress' })
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran).toHaveLength(0)

  await $.tool.call({ tool: 'TaskUpdate', taskId: 'Scena', status: 'completed' })
  await $.turn.complete({ ...TURN_END, turnId: 't2' })
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('tryb „przycisk”: nic nie rusza samo', { options: { handoffMode: 'przycisk' } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(190_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('tryb „auto”: rusza mimo zadania w toku', { options: { handoffMode: 'auto' } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.tool.call({ tool: 'TaskCreate', subject: 'Scena', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'Scena', status: 'in_progress' })
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('próg z ustawień', { options: { handoffTokens: 100_000 } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(110_000))
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('po /clear z „Wyczyść i wznów” Kokpit sam uruchamia /wznow tego wątku', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = { pendingResume: '/p/.claude/handoffs/cutscenka-plauen.md' }
  const clock = engine(on, ran, mem)
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(ran).toEqual([{ command: 'kokpit:wznow', args: 'cutscenka-plauen' }])
  expect(mem.pendingResume).toBeUndefined()
})

test('auto-compact dostaje instrukcję, żeby nie rozmywać decyzji', async ($, on) => {
  let instructions = ''
  on('session.compact', async (_$, e) => {
    instructions = e.instructions ?? ''
    return { skip: 'test' }
  })
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'x', toolUses: [] }] as never })
  expect(instructions).toContain('dosłownie')
})

for (const surface of SURFACES) {
  test(`${surface}: poniżej progu same liczniki`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('31%')
    expect(drawn).toContain('60k/200k')
    expect(await ui.find({ key: 'kokpit-handoff' })).toBeUndefined()
  })

  test(`${surface}: po progu „Teraz”, zapis wątku, potem „Wyczyść i wznów”`, async ($, on) => {
    const ran: Ran = []
    const mem: Record<string, unknown> = {}
    engine(on, ran, mem)
    await $.session.measure(measure(155_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    expect(JSON.stringify(await ui.drawn())).toContain('przy najbliższej przerwie')

    await ui.press({ key: 'kokpit-handoff' })
    expect(ran[0]?.command).toBe('kokpit:handoff')
    expect(JSON.stringify(await ui.drawn())).toContain('Piszę handoff')

    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/teren-bloto.md', content: '# T' })
    expect(JSON.stringify(await ui.drawn())).toContain('teren-bloto')

    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran[1]?.command).toBe('clear')
    expect(mem.pendingResume).toBe('/p/.claude/handoffs/teren-bloto.md')

    const log = mem.log as { thread: string; tokens: number }[]
    expect(log[0]).toMatchObject({ thread: 'teren-bloto', tokens: 155_000 })
  })

  test(`${surface}: koniec tury bez zapisu zdejmuje „Piszę handoff”`, async ($, on) => {
    engine(on, [])
    threads(on, { 'stary.md': Date.parse('2026-10-12T10:00:00Z') })
    await $.session.measure(measure(155_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'kokpit-handoff' })
    expect(JSON.stringify(await ui.drawn())).toContain('Piszę handoff')
    await $.turn.complete(TURN_END)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toContain('Piszę handoff')
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()
  })

  test(`${surface}: ręczny /kokpit:handoff zapisany poza Write kończy się „Wyczyść i wznów”`, async ($, on) => {
    engine(on, [])
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    expect(JSON.stringify(await ui.drawn())).toContain('Piszę handoff')
    files['testy-pokrycie.md'] = Date.parse('2026-10-13T10:00:30Z')
    await $.turn.complete(TURN_END)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toContain('Piszę handoff')
    expect(drawn).toContain('testy-pokrycie')
  })

  test(`${surface}: nieaktualny wątek — „Wyczyść i wznów” najpierw dopisuje handoff`, async ($, on) => {
    const ran: Ran = []
    const mem: Record<string, unknown> = {}
    const clock = engine(on, ran, mem)
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })

    // t1: handoff zapisany
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    expect(JSON.stringify(await ui.drawn())).toContain('✓ Wątek „watek” zapisany')

    // t2: rozmowa idzie dalej → zapis nieaktualny
    await $.turn.start({ text: 'dalej', turnId: 't2' })
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    expect(JSON.stringify(await ui.drawn())).toContain('Dopisz, wyczyść i wznów')

    // klik: nie czyści, tylko odpala handoff
    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])

    // t3: handoff dopisany → dopiero teraz /clear
    await $.turn.start({ text: '', turnId: 't3' })
    files['watek.md'] = Date.parse('2026-10-13T10:00:20Z')
    await $.turn.complete({ ...TURN_END, turnId: 't3' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff', 'clear'])
    expect(mem.pendingResume).toBe('.claude/handoffs/watek.md')
  })

  test(`${surface}: nieudane dopisanie nie czyści rozmowy`, async ($, on) => {
    const ran: Ran = []
    const clock = engine(on, ran)
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.turn.start({ text: '', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
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

  test(`${surface}: ręczne /clear przy nieaktualnym wątku czeka na handoff`, async ($, on) => {
    const ran: Ran = []
    const clock = engine(on, ran)
    const files: Record<string, number> = {}
    threads(on, files)
    await $.session.measure(measure(60_000))
    await $.turn.start({ text: '', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    const out = await $.command.run({ command: 'clear', args: '', origin: { kind: 'composer' } } as never)
    expect(String((out as { text?: string }).text)).toContain('najpierw dopisuję handoff')
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
  })

  test(`${surface}: tryb planowania — handoff nie rusza, czeka na wyjście`, async ($, on) => {
    const ran: Ran = []
    const clock = engine(on, ran)
    await $.session.measure(measure(160_000))
    await $.prompt.attachment({ type: 'plan_mode', text: '', detail: { reminder: 'full', planFilePath: '/x', hasPlan: false } } as never)
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.turn.complete(TURN_END)
    await clock.settle()
    expect(ran).toHaveLength(0)
    expect(JSON.stringify(await ui.drawn())).toContain('po wyjściu z trybu planowania')

    // ręczne /kokpit:handoff w trybie planowania: zamiast skilla notka, nic się nie pisze
    const out = await $.skill.prompt({ skill: 'kokpit:handoff', text: 'PEŁNY SKILL' })
    expect(out.text).toContain('trybie planowania')
    expect(JSON.stringify(await ui.drawn())).not.toContain('Piszę handoff')

    // wyjście z trybu planowania → handoff przy najbliższej przerwie
    await $.prompt.attachment({ type: 'plan_mode_exit', text: '', detail: { planFilePath: '/x', hasPlan: true } } as never)
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
  })

  test(`${surface}: agenty w tle wstrzymują /clear`, async ($, on) => {
    const ran: Ran = []
    engine(on, ran)
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'audyt', type: 'Explore', status: 'running' }] as never }))
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/x.md', content: '# X' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/x.md', content: '# X' })
    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran.map(r => r.command)).not.toContain('clear')
  })

  test(`${surface}: po wynikach agentów wątek jest dopisany i dopiero wtedy /clear`, async ($, on) => {
    const ran: Ran = []
    const mem: Record<string, unknown> = {}
    const clock = engine(on, ran, mem)
    const files: Record<string, number> = {}
    threads(on, files)
    let agents = [{ id: 'a1', description: 'audyt', type: 'Explore', status: 'running' }]
    on('agent.list', () => ({ value: agents as never }))
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })

    // t1: handoff zapisany, klik „Wyczyść i wznów” przy agencie w tle → czeka
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran.map(r => r.command)).not.toContain('clear')
    expect(JSON.stringify(await ui.drawn())).toContain('wyczyszczę po wynikach pracy w tle')

    // t2: agent jeszcze pracuje — nic
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    await clock.settle()
    expect(ran).toHaveLength(0)

    // t3: wynik agenta przyszedł, nic już nie pracuje → najpierw dopisanie wątku
    agents = []
    await $.turn.start({ text: '', turnId: 't3' })
    await $.turn.complete({ ...TURN_END, turnId: 't3' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])

    // t4: wątek dopisany → /clear i wznowienie
    await $.turn.start({ text: '', turnId: 't4' })
    files['watek.md'] = Date.parse('2026-10-13T10:00:30Z')
    await $.turn.complete({ ...TURN_END, turnId: 't4' })
    await clock.settle()
    expect(ran.map(r => r.command)).toEqual(['kokpit:handoff', 'clear'])
    expect(mem.pendingResume).toBe('.claude/handoffs/watek.md')
  })

  test(`${surface}: „Później” odkłada o 30k tokenów`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(155_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'kokpit-snooze' })
    expect(await ui.find({ key: 'kokpit-handoff' })).toBeUndefined()
    await $.session.measure(measure(186_000))
    expect(await ui.find({ key: 'kokpit-handoff' })).toBeDefined()
  })

  test(`${surface}: zapis archiwum wątku nie udaje zapisu wątku`, async ($, on) => {
    const ran: Ran = []
    engine(on, ran)
    const files: Record<string, number> = { 'watek.md': Date.parse('2026-10-13T09:00:00Z') }
    threads(on, files)
    await $.session.measure(measure(60_000))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })

    // t1: handoff dopisał tylko archiwum (Write wprost i plik na dysku) — wątek nie zapisany
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/watek.archiwum.md', content: '# A' })
    files['watek.archiwum.md'] = Date.parse('2026-10-13T10:00:10Z')
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()
    await $.turn.complete({ ...TURN_END, turnId: 't1' })
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()

    // t2: archiwum i wątek zapisane — gotowy jest wątek, nie archiwum
    await $.turn.start({ text: '/kokpit:handoff', turnId: 't2' })
    await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
    files['watek.md'] = Date.parse('2026-10-13T10:00:20Z')
    files['watek.archiwum.md'] = Date.parse('2026-10-13T10:00:25Z')
    await $.turn.complete({ ...TURN_END, turnId: 't2' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('✓ Wątek „watek” zapisany')
    expect(drawn).not.toContain('watek.archiwum')
  })

  test(`${surface}: zapis wątku bez trwającego handoffu nie udaje handoffu`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(60_000))
    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/x.md', content: '# X' })
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ key: 'kokpit-clear-resume' })).toBeUndefined()
  })

  test(`${surface}: zapis wątku przechodzi bez pytania, inny zapis nie`, async ($, on) => {
    engine(on, [])
    on('tool.check', () => ({ decision: 'ask' as const }))
    const ok = await $.tool.check({ tool: 'Edit', input: { file_path: '/p/.claude/handoffs/abc.md' } })
    const other = await $.tool.check({ tool: 'Write', input: { file_path: '/p/core/main.gd', content: '' } })
    expect(ok.decision).toBe('allow')
    expect(other.decision).toBe('ask')
  })

  test(`${surface}: lista zadań daje procent`, async ($, on) => {
    engine(on, [])
    await $.session.measure(measure(10_000))
    await $.tool.call({ tool: 'TaskCreate', subject: 'Zbudować', description: '' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Sprawdzić', description: '' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'Zbudować', status: 'completed' })
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('50%')
    expect(drawn).toContain('1/2')
  })
}
