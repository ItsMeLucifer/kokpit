import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clock, fillCommand, jobLine, parseProjectConfig, readLine, splitArgs } from '../hooks/background'
import { applyPrompt, entryFormat, nextId, parseDecisions, pending, resolveDecision, toApply } from '../hooks/decisions'
import { jobCommand } from '../hooks/register'
import type { Job } from '../types'

const SURFACES = ['terminal', 'desktop'] as const

const FILE = `# Decision register

Format description.

## D-001 · Drowning counts as an exact kill
- status: pending
- type: proposal
- area: terrain
- proposal: An enemy pushed into water counts as an exact kill.
- source: docs/terrain.md
- added: 2026-10-12

## D-002 · Replacement for the crest
- status: pending
- type: question
- area: UI
- question: What replaces crest.png?
- source: docs/assets.md
- added: 2026-09-17

## D-003 · Bow cooldown 5
- status: accepted
- type: proposal
- proposal: Bow 2 → 5.
- resolved: 2026-10-09
- applied: yes
`

const POLISH = `## D-007 · Błoto bez kary
- status: czeka
- typ: propozycja
- obszar: teren
- propozycja: Wejście w błoto nic nie kosztuje.
- źródło: docs/teren.md
- dodano: 2026-10-12

## D-008 · Herb
- status: przyjęta
- typ: pytanie
- pytanie: Czym zastąpić herb?
- rozstrzygnięto: 2026-10-09
- wprowadzono: tak
`

const PANE_PROPS = {
  title: 'Decisions',
  isFocused: true,
  bodyColumns: 120,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
  view: 'main',
} as never

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 12, contentRows: 2 },
  view: 'main',
} as never

/** Files in memory instead of the disk. The engine passes absolute paths; the keys are relative. */
function disk(on: On, files: Record<string, string>) {
  const key = (path: string) => Object.keys(files).find(k => path === k || path.endsWith('/' + k)) ?? path
  on('fs.exists', (_$, e) => ({ value: key(e.path) in files }))
  on('fs.read', (_$, e) => {
    const text = files[key(e.path)]
    if (text === undefined) throw new Error('ENOENT ' + e.path)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files[key(e.path)] = e.text
    return { value: undefined }
  })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.root', () => ({ value: '/p' }))
}

const CONFIG = JSON.stringify({
  tests: 'python3 tools/run_tests.py',
  jobs: { bench: 'godot --headless --script res://bench/{1}.gd -- {rest}', coverage: 'npm run coverage' },
})

// ── Register: pure functions ──

test('parsing entries', () => {
  const ds = parseDecisions(FILE)
  expect(ds.map(d => d.id)).toEqual(['D-001', 'D-002', 'D-003'])
  expect(ds[0]?.fields.proposal).toBe('An enemy pushed into water counts as an exact kill.')
  expect(pending(ds).map(d => d.id)).toEqual(['D-001', 'D-002'])
  expect(toApply(ds)).toHaveLength(0)
  expect(nextId(ds)).toBe('D-004')
})

test('a ruling changes only its own entry', () => {
  const out = resolveDecision(FILE, 'D-001', 'changed', '2026-10-13', 'Gold only,\nno contract')
  const ds = parseDecisions(out)
  expect(ds[0]?.status).toBe('changed')
  expect(ds[0]?.fields.answer).toBe('Gold only, no contract')
  expect(ds[0]?.fields.applied).toBe('no')
  expect(ds[1]?.status).toBe('pending')
  // The rest of the file is unchanged: the header and D-002 word for word.
  expect(out).toContain('# Decision register\n\nFormat description.')
  expect(out).toContain(FILE.slice(FILE.indexOf('## D-002'), FILE.indexOf('## D-003')))
  expect(toApply(ds).map(d => d.id)).toEqual(['D-001'])
  // A second ruling overwrites the fields instead of duplicating them.
  const again = resolveDecision(out, 'D-001', 'accepted', '2026-10-14')
  expect(again.match(/- status:/g)?.length).toBe(3)
  expect(parseDecisions(again)[0]?.fields.resolved).toBe('2026-10-14')
})

test('a Polish register is read, and a ruling keeps the entry in Polish', () => {
  const ds = parseDecisions(POLISH)
  expect(ds.map(d => [d.id, d.status, d.language])).toEqual([
    ['D-007', 'pending', 'pl'],
    ['D-008', 'accepted', 'pl'],
  ])
  expect(ds[0]?.fields.source).toBe('docs/teren.md')
  expect(toApply(ds)).toHaveLength(0)
  const out = resolveDecision(POLISH, 'D-007', 'changed', '2026-10-13', 'Tylko złoto')
  expect(out).toContain('- status: inaczej')
  expect(out).toContain('- odpowiedź: Tylko złoto')
  expect(out).toContain('- wprowadzono: nie')
  expect(entryFormat('pl')).toContain('- typ: propozycja|pytanie')
  expect(entryFormat('en')).toContain('- type: proposal|question')
})

test('the instruction to carry rulings into the documents', () => {
  const ds = parseDecisions(resolveDecision(FILE, 'D-002', 'accepted', '2026-10-13', 'The Leliwa crest'))
  const text = applyPrompt('docs/decisions.md', toApply(ds))
  expect(text).toContain('D-002 · Replacement for the crest: accepted — answer: "The Leliwa crest"')
  expect(text).toContain('as applied')
})

// ── Background jobs: pure functions ──

test('project config, command templates and job requests', () => {
  const config = parseProjectConfig(CONFIG)
  expect(fillCommand('npm test --', ['camp', 'a b'])).toBe("npm test -- camp 'a b'")
  expect(fillCommand('godot --script res://bench/{1}.gd -- {rest}', ['level', 'sword', '150'])).toBe('godot --script res://bench/level.gd -- sword 150')
  expect(jobCommand(config, 'tests', 'camp forge')).toEqual({ kind: 'tests', label: 'tests camp forge', command: 'python3 tools/run_tests.py camp forge' })
  expect(jobCommand(config, 'job', 'bench malbork sword').command).toBe('godot --headless --script res://bench/malbork.gd -- sword')
  expect(() => jobCommand({}, 'tests', '')).toThrow('No test command')
  expect(() => jobCommand(config, 'job', 'nope')).toThrow('known: bench, coverage')
  expect(() => jobCommand(config, 'command', '  ')).toThrow()
  expect(parseProjectConfig('{"jobs": {"bad name": "x", "ok": ""}}')).toEqual({})
  expect(splitArgs('wave_matrix level /tmp/wm.json "sword;sword:edge"')).toEqual(['wave_matrix', 'level', '/tmp/wm.json', 'sword;sword:edge'])
})

test('progress from test runner output', () => {
  const base: Job = {
    id: 'x', label: 'tests', kind: 'tests', byClaude: false, startedAt: 0, endedAt: null, code: null, total: null,
    passed: 0, failed: 0, failedNames: [], lastLine: '', logPath: null, hidden: false,
  }
  let j = readLine(base, 'Tests: 3, parallel: 4, project: /p')
  j = readLine(j, '  PASS  test_camp                            12.1s')
  j = readLine(j, '  FAIL  test_forge                            3.0s  [exit 1] log: x.log')
  expect([j.total, j.passed, j.failed, j.failedNames]).toEqual([3, 1, 1, ['test_forge']])
  expect(readLine(base, 'Testy: 7').total).toBe(7)
  expect(jobLine(j, 75_000)).toBe('⧗ tests · 1:15 · 1/3 ✓ · 1 ✗')
  expect(jobLine({ ...j, endedAt: 90_000, code: 1 }, 0)).toBe('✗ tests · 1:30 · 1/3 ✓ · 1 ✗ — test_forge')
  expect(clock(3_725_000)).toBe('1:02:05')
})

// ── Behaviour in a session ──

for (const surface of SURFACES) {
  test(`${surface}: decisions pane, Accept writes to the file`, async ($, on) => {
    const files: Record<string, string> = { 'docs/decisions.md': FILE }
    disk(on, files)
    mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-decisions' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('D-001 · Drowning counts as an exact kill')
    expect(drawn).toContain('D-002 · Replacement for the crest  (question)')
    expect(drawn).not.toContain('D-003')
    // A question has no Accept/Reject buttons, only the answer field.
    expect(await ui.find({ key: 'ok-D-002' })).toBeUndefined()

    await ui.press({ key: 'ok-D-001' })
    expect(parseDecisions(files['docs/decisions.md'] ?? '')[0]).toMatchObject({ status: 'accepted' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('D-001 · Drowning')
    expect(await ui.find({ key: 'kokpit-apply' })).toBeDefined()
  })

  test(`${surface}: answering a question and "Apply to documents"`, async ($, on) => {
    const files: Record<string, string> = { 'docs/decisions.md': FILE }
    disk(on, files)
    mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    const sent: string[] = []
    on('prompt.submit', async (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    on('ui.close', () => ({ value: undefined }))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-decisions' })
    await ui.input({ key: 'in-D-002', text: 'The Leliwa crest' })
    const d2 = parseDecisions(files['docs/decisions.md'] ?? '')[1]
    expect(d2).toMatchObject({ status: 'accepted' })
    expect(d2?.fields.answer).toBe('The Leliwa crest')

    await ui.press({ key: 'kokpit-apply' })
    expect(sent[0]).toContain('D-002 · Replacement for the crest: accepted — answer: "The Leliwa crest"')
  })

  test(`${surface}: /tests in the background, progress in the band and the result`, async ($, on) => {
    const files: Record<string, string> = { '.claude/kokpit.json': CONFIG }
    disk(on, files)
    const clk = mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    on('session.measure', async (_$, e) => ({ changed: e.changed }))
    on('ui.toast', () => ({ value: undefined }))
    let argv: readonly string[] = []
    on('process.spawn', async function* (_$, e) {
      argv = e.argv
      yield { stream: 'stdout' as const, text: '__KOKPIT_PID__ 4242\nTests: 2, parallel: 2, project: /p\n' }
      yield { stream: 'stdout' as const, text: '  PASS  test_camp   3.0s\n  FAIL  test_forge   1.0s  [exit 1]\n' }
      yield { stream: 'stdout' as const, text: '\n1/2 passed in 4 s\n' }
      return { value: { code: 1, signal: null } }
    })
    await $.session.measure({ context: { tokens: 10_000, window: 200_000, percent: 5 }, rateLimits: [], changed: ['context'] })
    const reply = await $.command.run({ command: 'tests', args: 'camp forge' } as never)
    expect(reply.text).toContain('in the background')
    await clk.advance(5000)
    expect(argv.slice(-1)[0]).toBe('python3 tools/run_tests.py camp forge')
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('✗ tests camp forge')
    expect(drawn).toContain('1/2 ✓ · 1 ✗ — test_forge')
    expect(Object.keys(files).some(f => f.includes('.claude/kokpit/jobs/') && f.endsWith('.log'))).toBe(true)
    // Started by the user: the result waits for the button, Claude does not get it by itself.
    expect(drawn).toContain('Show Claude')
  })

  test(`${surface}: /tests without a configured command explains what to set`, async ($, on) => {
    disk(on, {})
    const reply = await $.command.run({ command: 'tests', args: '' } as never)
    expect(reply.text).toContain('.claude/kokpit.json')
  })

  test(`${surface}: the background tool returns at once and the result goes to Claude`, async ($, on) => {
    disk(on, { '.claude/kokpit.json': CONFIG })
    const clk = mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    const sent: string[] = []
    on('prompt.submit', async (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    let argv: readonly string[] = []
    on('process.spawn', async function* (_$, e) {
      argv = e.argv
      yield { stream: 'stdout' as const, text: 'states: 157031\nmin damage: 0, turns: 86\n' }
      return { value: { code: 0, signal: null } }
    })
    const r = await $.tool.call({ tool: 'mcp__kokpit__background', kind: 'job', args: 'bench malbork sword 5000000', label: 'Benchmark Malbork' } as never)
    expect(String((r as { result?: unknown }).result)).toContain('Started in the background')
    await clk.advance(2000)
    expect(argv.join(' ')).toContain('res://bench/malbork.gd -- sword 5000000')
    expect(sent[0]).toContain('Background job "Benchmark Malbork" succeeded')
    expect(sent[0]).toContain('min damage: 0, turns: 86')
  })

  test(`${surface}: a background result does not cover a question; it waits and goes with the answer`, async ($, on) => {
    disk(on, { '.claude/kokpit.json': CONFIG })
    const clk = mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', async () => ({ text: '' }))
    on('session.measure', async (_$, e) => ({ changed: e.changed }))
    const sent: { text: string; context?: readonly string[] }[] = []
    on('prompt.submit', async (_$, e) => {
      sent.push({ text: e.text, context: e.context })
      return { text: e.text }
    })
    let finish: () => void = () => {}
    const done = new Promise<void>(res => (finish = res))
    on('process.spawn', async function* () {
      await done
      yield { stream: 'stdout' as const, text: 'Tests: 1\n  PASS  test_acts\n1/1 passed\n' }
      return { value: { code: 0, signal: null } }
    })
    await $.session.measure({ context: { tokens: 10_000, window: 200_000, percent: 5 }, rateLimits: [], changed: ['context'] })
    await $.turn.start({ text: 'make the background', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__kokpit__background', kind: 'tests', args: '', label: 'Tests after background' } as never)
    // the turn ends with a question and the result arrives right after
    await $.turn.complete({ answer: 'Background ready.\n\nDo we keep it or do another round?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    finish()
    await clk.advance(2000)
    expect(sent).toHaveLength(0)
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(JSON.stringify(await ui.drawn())).toContain('is waiting for your answer')

    // the user's answer takes the result along as context
    await $.prompt.submit({ text: 'we keep it', origin: { kind: 'composer' }, wait: false } as never)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('we keep it')
    expect((sent[0]?.context ?? []).join('')).toContain('Tests after background')
  })

  test(`${surface}: a result during a turn without a question goes to Claude after the turn`, async ($, on) => {
    disk(on, { '.claude/kokpit.json': CONFIG })
    const clk = mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', async () => ({ text: '' }))
    const sent: string[] = []
    on('prompt.submit', async (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    on('process.spawn', async function* () {
      yield { stream: 'stdout' as const, text: '1/1 passed\n' }
      return { value: { code: 0, signal: null } }
    })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__kokpit__background', kind: 'tests', args: '', label: 'Tests' } as never)
    await clk.advance(2000)
    expect(sent).toHaveLength(0)
    await $.turn.complete({ answer: 'Working on, waiting for the tests.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    expect(sent).toHaveLength(1)
  })
}
