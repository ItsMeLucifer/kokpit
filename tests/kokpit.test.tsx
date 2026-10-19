import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hiddenSkills, parseShare, withSkill } from '../hooks/narzedzia'
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
  on('store.keys', () => ({ value: Object.keys(mem) }))
}

/** Id okna rozmowy w testach (= id sesji z `engine`) i klucz mostu przez /clear tego okna. */
const OWNER = 'sesja-1'
const flow = (name: string) => `${name}:${OWNER}`
const NOW = Date.parse('2026-10-13T10:00:00Z')

/** To, co w sesji robi silnik pod pluginami: pomiar, polecenia, narzędzia, zegar, magazyn. */
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

test('zadanie skończone: cała lista odhaczona albo brak listy', () => {
  expect(isFinished([])).toBe(true)
  expect(isFinished([{ id: '1', subject: 'a', status: 'completed' }])).toBe(true)
  expect(isFinished([{ id: '1', subject: 'a', status: 'completed' }, { id: '2', subject: 'b', status: 'pending' }])).toBe(false)
  expect(isFinished([{ id: '1', subject: 'a', status: 'in_progress' }])).toBe(false)
})

test('twardy próg: miękki + 100k, nie dalej niż 85% okna, nie bliżej niż miękki', () => {
  expect(hardThresholdFor(200_000, 0, 1_000_000)).toBe(300_000)
  expect(hardThresholdFor(150_000, 0, 200_000)).toBe(170_000)
  expect(hardThresholdFor(200_000, 260_000, 1_000_000)).toBe(260_000)
  expect(hardThresholdFor(200_000, 100_000, 1_000_000)).toBe(200_000)
})

test('sam handoff: jeden na rozmowę, miękki po skończonym zadaniu, twardy zawsze', () => {
  expect(autoDue(210_000, 200_000, 300_000, H0, true)).toBe(true)
  expect(autoDue(210_000, 200_000, 300_000, H0, false)).toBe(false)
  expect(autoDue(310_000, 200_000, 300_000, H0, false)).toBe(true)
  expect(autoDue(190_000, 200_000, 300_000, H0, true)).toBe(false)
  expect(autoDue(400_000, 200_000, 300_000, { ...H0, lastTokens: 210_000 }, true)).toBe(false)
  expect(autoDue(310_000, 200_000, 300_000, { ...H0, snoozedUntil: 340_000 }, true)).toBe(false)
  expect(autoDue(310_000, 200_000, 300_000, { ...H0, running: true }, true)).toBe(false)
  expect(autoDue(null, 200_000, 300_000, H0, true)).toBe(false)
})

test('odpowiedź kończąca się pytaniem', () => {
  expect(endsWithQuestion('Gotowe.\n\nRobię obie części?')).toBe(true)
  expect(endsWithQuestion('**Robię?**')).toBe(true)
  expect(endsWithQuestion('Czy to działa? Tak.\nGotowe.')).toBe(false)
  expect(endsWithQuestion('')).toBe(false)
})

test('lista zadań aplikacji: nowa lista, advance, done, start', () => {
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
  expect(applyPlan([], { items: [{ content: 'X', status: 'dziwny' }] })[0]?.status).toBe('pending')
})

test('plik ostatnich odpowiedzi i notka dla nowej sesji', () => {
  const md = answersMarkdown(
    'watek',
    [
      { at: '2026-10-18T19:30:00.000Z', text: 'Pierwsza' },
      { at: '2026-10-18T19:34:00.000Z', text: 'Robię?' },
    ],
    '2026-10-18T19:35:00.000Z',
  )
  expect(md).toContain('# Ostatnie odpowiedzi przed wyczyszczeniem rozmowy — watek')
  expect(md).toContain('## Odpowiedź 2 z 2 · 19:34')
  expect(md).toContain('Robię?')
  expect(previousContext(md)).toContain('zrób punkt 2')
})

test('narzędzia: udział kodu w grafie i skille ukryte w ustawieniach projektu', () => {
  expect(parseShare('  udział kodu w grafie: 26% (próg 60%)')).toBe(0.26)
  expect(parseShare('nic')).toBeNull()
  const hidden = withSkill('{\n  "model": "opus"\n}', 'anthropic-skills:prawo', true)
  expect(JSON.parse(hidden)).toEqual({
    model: 'opus',
    skillOverrides: { 'anthropic-skills:prawo': 'user-invocable-only', prawo: 'user-invocable-only' },
  })
  expect(hiddenSkills(JSON.parse(hidden).skillOverrides)).toEqual(['anthropic-skills:prawo'])
  expect(JSON.parse(withSkill(hidden, 'anthropic-skills:prawo', false))).toEqual({ model: 'opus' })
  expect(JSON.parse(withSkill(null, 'moj-skill', true))).toEqual({ skillOverrides: { 'moj-skill': 'user-invocable-only' } })
  expect(() => withSkill('{ zepsuty', 'x', true)).toThrow()
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
  // dopisanie przed czyszczeniem nie jest ani automatycznym handoffem, ani przyciskiem
  const refreshed = [...log, { at: '2026-10-13T09:30:00Z', tokens: 130_000, thread: 'a', mode: 'dopisanie' as const }]
  expect(stats(refreshed, now)).toBe(
    'Handoffy dziś: 2 · ostatnie 7 dni: 3 w 2 wątkach · średnio przy 150k tokenów · automatycznych: 1 · dopisań przy wiadomości: 1',
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
  const mem: Record<string, unknown> = {
    [flow('pendingResume')]: '/p/.claude/handoffs/cutscenka-plauen.md',
    [flow('pendingAt')]: NOW - 2_000,
  }
  const clock = engine(on, ran, mem)
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(ran).toEqual([{ command: 'kokpit:wznow', args: 'cutscenka-plauen' }])
  expect(mem[flow('pendingResume')]).toBeUndefined()
  expect(mem[flow('pendingAt')]).toBeUndefined()
})

test('/clear nie bierze mostu innego okna ani przeterminowanego', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {
    // równoległa sesja (inne okno, może inny projekt) właśnie czyści — nie nasze
    'pendingResume:sesja-2': '/inny/.claude/handoffs/obcy.md',
    'pendingPrompt:sesja-2': 'wiadomość z innego okna',
    'pendingAt:sesja-2': NOW - 1_000,
    // nasze, ale sprzed godziny (nieudane czyszczenie)
    [flow('pendingResume')]: '/p/.claude/handoffs/stary.md',
    [flow('pendingPrompt')]: 'dawno nieaktualne',
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
  expect(mem['pendingPrompt:sesja-2']).toBe('wiadomość z innego okna')
})

test('rozjechany katalog sesji (cd w Bashu) — pliki Kokpitu dalej od korzenia projektu', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  // po `cd .claude/handoffs` w Bashu katalog sesji jest tam, korzeń projektu dalej /p
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
  await turn($, 't0', 'Odpowiedź do zapamiętania.')
  await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: 'dalej', ...USER })
  await clock.settle()
  expect(r.drop).toBeDefined()
  expect(listed.every(p => p === '/p/.claude/handoffs')).toBe(true)
  expect(writes).toEqual(['/p/.claude/kokpit/ostatnie/watek.md'])
  expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/watek.md')
  expect(mem[flow('pendingPrevious')]).toBe('/p/.claude/kokpit/ostatnie/watek.md')
  expect(isHandoffPath('/p/.claude/handoffs/watek.md', '/p')).toBe(true)
})

test('świeżość mostu i sprzątanie resztek w magazynie', () => {
  expect(isFresh(NOW - 60_000, NOW)).toBe(true)
  expect(isFresh(NOW - 6 * 60_000, NOW)).toBe(false)
  expect(isFresh(undefined, NOW)).toBe(false)
  const store: Record<string, unknown> = {
    log: [],
    pendingContext: '.claude/kokpit/ostatnie/x.md',
    pendingResume: '.claude/handoffs/x.md',
    'pendingPrompt:zywe': 'w toku',
    'pendingAt:zywe': NOW - 120_000,
    'pendingResume:martwe': '/p/.claude/handoffs/y.md',
    'pendingAt:martwe': NOW - 2 * 3_600_000,
    'pendingPrompt:bez-czasu': 'sierota',
  }
  expect(orphanKeys(Object.keys(store), store, NOW).sort()).toEqual(
    ['pendingAt:martwe', 'pendingContext', 'pendingPrompt:bez-czasu', 'pendingResume', 'pendingResume:martwe'].sort(),
  )
})

test('start sesji usuwa stary klucz pendingContext', async ($, on) => {
  const mem: Record<string, unknown> = { pendingContext: '.claude/kokpit/ostatnie/odpychanie-salwa.md', log: [] }
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
    expect(JSON.stringify(await ui.drawn())).toContain('po skończonym zadaniu')

    await ui.press({ key: 'kokpit-handoff' })
    expect(ran[0]?.command).toBe('kokpit:handoff')
    expect(JSON.stringify(await ui.drawn())).toContain('Piszę handoff')

    await $.tool.call({ tool: 'Write', file_path: '/p/.claude/handoffs/teren-bloto.md', content: '# T' })
    expect(JSON.stringify(await ui.drawn())).toContain('teren-bloto')

    await ui.press({ key: 'kokpit-clear-resume' })
    expect(ran[1]?.command).toBe('clear')
    expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/teren-bloto.md')

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
    expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/watek.md')
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
    expect(mem[flow('pendingResume')]).toBe('/p/.claude/handoffs/watek.md')
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

// ── Handoff bez irytacji: lista zadań aplikacji, pytanie, twardy próg, jeden na rozmowę ──

const PLAN = 'mcp__ccd_turn__update_plan'
const WRAP = 'mcp__ccd_turn__wrap_up'
const USER = { wait: false, origin: { kind: 'composer' as const } }

/** Ścieżka od `.claude/` — silnik podaje operacjom na plikach ścieżki bezwzględne. */
const rel = (path: string) => path.slice(Math.max(0, path.indexOf('.claude/')))

/** Pliki tekstowe, wysłane wiadomości i otwarte panele — w pamięci. */
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

/** Tura z odpowiedzią (turn.start → turn.complete), jak w sesji. */
async function turn($: Engine, id: string, answer = '') {
  await $.turn.start({ text: '', turnId: id })
  await $.turn.complete({ ...TURN_END, turnId: id, answer })
}

test('przerwa: lista zadań aplikacji w toku czeka, po wrap_up rusza', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: 'commit i merge', turnId: 't1' })
  await $.tool.call({
    tool: PLAN,
    tool_use_id: 'u1',
    items: [
      { content: 'Commit', status: 'in_progress' },
      { content: 'Merge', status: 'pending' },
    ],
  })
  await $.turn.complete({ ...TURN_END, turnId: 't1', answer: 'Czekam na CI.' })
  await clock.settle()
  expect(ran).toHaveLength(0)

  await $.turn.start({ text: '', turnId: 't2' })
  await $.tool.call({ tool: WRAP, tool_use_id: 'u2', recap: 'Scalone.' })
  await $.turn.complete({ ...TURN_END, turnId: 't2', answer: 'Scalone do master.' })
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('pytanie do użytkownika wstrzymuje miękki próg, jego odpowiedź go zwalnia', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.tool.call({ tool: WRAP, tool_use_id: 'u1', recap: 'Projekt gotowy.', ask: 'Wprowadzić poprawki?' })
  await $.turn.complete({ ...TURN_END, turnId: 't1', answer: 'Projekt A–F.' })
  await clock.settle()
  expect(ran).toHaveLength(0)

  await turn($, 't2', 'Robię obie części, czy najpierw handoff?')
  await clock.settle()
  expect(ran).toHaveLength(0)

  await turn($, 't3', 'Zrobione.')
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('twardy próg: handoff mimo pracy w toku i pytania', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  await $.session.measure(measure(175_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.tool.call({ tool: PLAN, tool_use_id: 'u1', items: [{ content: 'Długa praca', status: 'in_progress' }] })
  await $.turn.complete({ ...TURN_END, turnId: 't1', answer: 'Dalej?' })
  await clock.settle()
  expect(ran.map(r => r.command)).toEqual(['kokpit:handoff'])
})

test('po zapisanym handoffie drugi sam już nie rusza (koniec spamu)', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '/kokpit:handoff', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })

  // powiadomienia z pracy w tle dobijają kontekst — kolejne tury bez nowego handoffu
  await $.session.measure(measure(168_000))
  await turn($, 't2', 'Testy przeszły.')
  await turn($, 't3', 'Probierz skończył.')
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('wiadomość po zapisie: odpowiedzi do pliku, /clear, wznowienie i ta sama wiadomość w nowej sesji', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  const clock = engine(on, ran, mem)
  const files: Record<string, number> = {}
  threads(on, files)
  const io = desk(on)
  const session = mock.session(on)
  on('classic.SessionStart', async () => ({}))
  await $.session.measure(measure(60_000))

  await turn($, 't1', 'Pierwsza odpowiedź.')
  await turn($, 't2', 'Projekt A–F. Robię?')
  await $.turn.start({ text: '/kokpit:handoff', turnId: 't3' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't3', answer: 'Wątek zapisany.' })

  const r = await $.prompt.submit({ text: 'tak, oba', ...USER })
  expect(String(r.drop)).toContain('czyszczę rozmowę')
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['clear'])
  expect(mem[flow('pendingPrompt')]).toBe('tak, oba')
  const saved = io.written['.claude/kokpit/ostatnie/watek.md'] ?? ''
  expect(saved).toContain('Pierwsza odpowiedź.')
  expect(saved).toContain('Projekt A–F. Robię?')
  expect(saved).not.toContain('Wątek zapisany.')

  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(ran).toEqual([
    { command: 'clear', args: '' },
    { command: 'kokpit:wznow', args: 'watek po-czyszczeniu' },
  ])
  expect(io.submitted).toEqual(['tak, oba'])
  expect(mem[flow('pendingPrompt')]).toBeUndefined()
  expect(JSON.stringify(session.appended())).toContain('Projekt A–F. Robię?')
  expect(io.opened).toContain('kokpit-poprzednie')
})

test('wiadomość po rozmowie dalej od zapisu: toast, dopisanie z trybem „dopisanie” w dzienniku, potem /clear', async ($, on) => {
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
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await turn($, 't2', 'Rozmowa poszła dalej.')

  const r = await $.prompt.submit({ text: 'już minął sleep', ...USER })
  expect(String(r.drop)).toContain('to nie błąd')
  expect(String(r.drop)).toContain('dopisuję wątek „watek”')
  expect(toasts).toEqual([String(r.drop)])
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['kokpit:handoff'])

  await $.turn.start({ text: '/kokpit:handoff', turnId: 't3' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:20Z')
  await $.turn.complete({ ...TURN_END, turnId: 't3' })
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['kokpit:handoff', 'clear'])
  expect(mem[flow('pendingPrompt')]).toBe('już minął sleep')
  const log = mem.log as { mode: string }[]
  expect(log.map(l => l.mode)).toEqual(['przycisk', 'dopisanie'])
})

test('wiadomość w trakcie handoffu czeka i po zapisie idzie do nowej sesji', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  const clock = engine(on, ran, mem)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  const r = await $.prompt.submit({ text: 'miałem odpowiedzieć', ...USER, turnId: 't1' })
  expect(String(r.drop)).toContain('kończę handoff')
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await clock.settle()
  expect(ran.map(x => x.command)).toEqual(['clear'])
  expect(mem[flow('pendingPrompt')]).toBe('miałem odpowiedzieć')
})

test('nieudany handoff oddaje wstrzymaną wiadomość tej rozmowie', async ($, on) => {
  const ran: Ran = []
  const mem: Record<string, unknown> = {}
  const clock = engine(on, ran, mem)
  threads(on, {})
  const io = desk(on)
  await $.session.measure(measure(160_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  await $.prompt.submit({ text: 'odpowiedź', ...USER, turnId: 't1' })
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await clock.settle()
  expect(ran.map(x => x.command)).not.toContain('clear')
  expect(io.submitted).toEqual(['odpowiedź'])
  expect(mem[flow('pendingPrompt')]).toBeUndefined()
})

test('praca w tle: wiadomość zostaje w tej rozmowie, bez czyszczenia', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'audyt', type: 'Explore', status: 'running' }] as never }))
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: 'dalej', ...USER })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('czyszczenie przyciskiem: wiadomość po zapisie przechodzi', { options: { handoffClear: 'przycisk' } }, async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: 'dalej', ...USER })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('wiadomość w trakcie innej tury przechodzi — /clear by ją przerwał', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  await $.turn.start({ text: 'powiadomienie z tła', turnId: 't2' })
  const r = await $.prompt.submit({ text: 'a jeszcze', ...USER, turnId: 't2' })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

test('polecenie po zapisie nie jest wstrzymywane', async ($, on) => {
  const ran: Ran = []
  const clock = engine(on, ran)
  const files: Record<string, number> = {}
  threads(on, files)
  desk(on)
  await $.session.measure(measure(60_000))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'kokpit:handoff', text: '' })
  files['watek.md'] = Date.parse('2026-10-13T10:00:10Z')
  await $.turn.complete({ ...TURN_END, turnId: 't1' })
  const r = await $.prompt.submit({ text: '/decyzje', ...USER, command: { name: 'decyzje', args: '' } })
  expect(r.drop).toBeUndefined()
  await clock.settle()
  expect(ran).toHaveLength(0)
})

for (const surface of SURFACES) {
  test(`${surface}: po czyszczeniu „Poprzednie odpowiedzi” w pasku i w panelu`, async ($, on) => {
    const mem: Record<string, unknown> = {
      [flow('pendingPrevious')]: '/p/.claude/kokpit/ostatnie/watek.md',
      [flow('pendingAt')]: NOW - 1_000,
    }
    const clock = engine(on, [], mem)
    threads(on, {})
    const io = desk(on)
    io.written['.claude/kokpit/ostatnie/watek.md'] = '# Ostatnie odpowiedzi\n\nProjekt A–F. Robię?'
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
        title: 'Poprzednie odpowiedzi',
        isFocused: true,
        bodyColumns: 120,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
        view: 'main',
      } as never,
      requestId: 'kokpit-poprzednie',
    })
    expect(JSON.stringify(await pane.drawn())).toContain('Projekt A–F. Robię?')
  })
}

for (const surface of SURFACES) {
  test(`${surface}: /narzedzia — graphify nie pasuje, ukrycie skilla zapisuje ustawienia projektu`, async ($, on) => {
    engine(on, [])
    threads(on, {})
    const io = desk(on)
    on('process.run', (_$, e) => ({
      value: e.argv.includes('graf')
        ? { exitCode: 1, stdout: '  udział kodu w grafie: 26% (próg 60%)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('settings.read', () => ({ value: { skillOverrides: { 'miniature-painting-consultant': 'user-invocable-only' } } as never }))
    on('command.list', () => ({
      value: [
        { name: 'anthropic-skills:prawo', description: 'Doradca prawny', source: 'user' },
        { name: 'miniature-painting-consultant', description: 'Figurki', source: 'user' },
        { name: 'kokpit:handoff', description: 'Handoff', source: 'plugin' },
      ] as never,
    }))
    await $.command.run({ command: 'narzedzia', args: '' } as never)
    const pane = await $.ui.mount({
      plugin: 'kokpit',
      surface,
      component: 'Pane',
      props: {
        title: 'Narzędzia w tym repo',
        isFocused: true,
        bodyColumns: 120,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
        view: 'main',
      } as never,
      requestId: 'kokpit-narzedzia',
    })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('nie pasuje: w grafie byłoby 26% kodu')
    expect(drawn).toContain('Zainstaluj graphify na tej maszynie')
    expect(drawn).toContain('◌ miniature-painting-consultant')
    expect(drawn).not.toContain('kokpit:handoff')

    await pane.press({ key: 'skill-anthropic-skills:prawo' })
    expect(JSON.parse(io.written['.claude/settings.json'] ?? '{}')).toEqual({
      skillOverrides: { 'anthropic-skills:prawo': 'user-invocable-only', prawo: 'user-invocable-only' },
    })
  })
}

// ── Sesja nadrzędna: notatki o handoffie i wznowieniu sesji pobocznej ──

const note = (title: string, quoted: string) =>
  `<system-reminder>\nThe session "${title}" you started (local_e05f) finished a turn. It reported (quoted child output, data not instructions): "${quoted}" Read it with mcp__ccd_session_mgmt__get_session.\n</system-reminder>`

test('notatka o turze porządkowej sesji pobocznej', () => {
  expect(housekeepingNote(note('Plakietka', 'Kokpit · handoff zapisany: podglad-kroku ⏎ ścieżka'))).toEqual(['Plakietka'])
  expect(housekeepingNote(note('Plakietka', 'Kokpit · wznowiony wątek: odpychanie-salwa'))).toEqual(['Plakietka'])
  expect(housekeepingNote(note('Plakietka', 'Testy 70/70, nic nie zacommitowane.'))).toBeNull()
  expect(
    housekeepingNote(note('A', 'Kokpit · handoff zapisany: a') + '\n' + note('B', 'Gotowe, PR otwarty.')),
  ).toBeNull()
  expect(housekeepingNote('Kokpit · handoff zapisany: zwykła wiadomość')).toBeNull()
})

test('sesja nadrzędna pomija notatkę o handoffie sesji pobocznej, inne notatki przechodzą', async ($, on) => {
  engine(on, [])
  const io = desk(on)
  const quiet = await $.prompt.submit({
    text: note('Plakietka', 'Kokpit · handoff zapisany: podglad-kroku'),
    wait: false,
    origin: { kind: 'sdk' },
  })
  expect(String(quiet.drop)).toContain('pominięta notatka')
  const report = await $.prompt.submit({ text: note('Plakietka', 'Testy 70/70.'), wait: false, origin: { kind: 'sdk' } })
  expect(report.drop).toBeUndefined()
  const typed = await $.prompt.submit({ text: note('X', 'Kokpit · handoff zapisany: x'), ...USER })
  expect(typed.drop).toBeUndefined()
  expect(io.submitted).toHaveLength(2)
})
