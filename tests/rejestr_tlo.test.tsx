import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { applyPrompt, nextId, parseDecisions, pending, resolveDecision, toApply } from '../hooks/decyzje'
import { clock, jobLine, probierzArgv, readLine, splitArgs, testsArgv } from '../hooks/tlo'
import type { Job } from '../types'

const SURFACES = ['terminal', 'desktop'] as const

const FILE = `# Rejestr decyzji

Opis formatu.

## D-001 · Utonięcie = zabicie dokładne
- status: czeka
- typ: propozycja
- obszar: teren
- propozycja: Wepchnięty w wodę wróg liczy się jak zabicie dokładne.
- źródło: claude/analiza_roguelike.md
- dodano: 2026-10-12

## D-002 · Zastępnik herbu Polski
- status: czeka
- typ: pytanie
- obszar: UI
- pytanie: Czym zastąpić herb_polska.png?
- źródło: claude/higgsfield_asset_plan.md
- dodano: 2026-09-17

## D-003 · Odnowienie łuku 5
- status: przyjęta
- typ: propozycja
- propozycja: Łuk 2 → 5.
- rozstrzygnięto: 2026-10-09
- wprowadzono: tak
`

const PANE_PROPS = {
  title: 'Decyzje',
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

/** Pliki w pamięci zamiast dysku. */
/** Pliki w pamięci zamiast dysku. Silnik podaje ścieżki bezwzględne — klucze są względne. */
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
}

// ── Rejestr: czyste funkcje ──

test('parsowanie wpisów', () => {
  const ds = parseDecisions(FILE)
  expect(ds.map(d => d.id)).toEqual(['D-001', 'D-002', 'D-003'])
  expect(ds[0]?.fields['propozycja']).toBe('Wepchnięty w wodę wróg liczy się jak zabicie dokładne.')
  expect(pending(ds).map(d => d.id)).toEqual(['D-001', 'D-002'])
  expect(toApply(ds)).toHaveLength(0)
  expect(nextId(ds)).toBe('D-004')
})

test('rozstrzygnięcie zmienia tylko swój wpis', () => {
  const out = resolveDecision(FILE, 'D-001', 'inaczej', '2026-10-13', 'Tylko złoto,\nbez kontraktu')
  const ds = parseDecisions(out)
  expect(ds[0]?.status).toBe('inaczej')
  expect(ds[0]?.fields['odpowiedź']).toBe('Tylko złoto, bez kontraktu')
  expect(ds[0]?.fields['wprowadzono']).toBe('nie')
  expect(ds[1]?.status).toBe('czeka')
  // Reszta pliku bez zmian: nagłówek i wpis D-002 słowo w słowo.
  expect(out).toContain('# Rejestr decyzji\n\nOpis formatu.')
  expect(out).toContain(FILE.slice(FILE.indexOf('## D-002'), FILE.indexOf('## D-003')))
  expect(toApply(ds).map(d => d.id)).toEqual(['D-001'])
  // Drugie rozstrzygnięcie nadpisuje pola, nie dubluje ich.
  const again = resolveDecision(out, 'D-001', 'przyjęta', '2026-10-14')
  expect(again.match(/- status:/g)?.length).toBe(3)
  expect(parseDecisions(again)[0]?.fields['rozstrzygnięto']).toBe('2026-10-14')
})

test('polecenie przeniesienia do dokumentów', () => {
  const ds = parseDecisions(resolveDecision(FILE, 'D-002', 'przyjęta', '2026-10-13', 'Herb Leliwa'))
  const text = applyPrompt('docs/decyzje.md', toApply(ds))
  expect(text).toContain('D-002 · Zastępnik herbu Polski: przyjęta — odpowiedź: „Herb Leliwa”')
  expect(text).toContain('wprowadzono: tak')
})

// ── Zadania w tle: czyste funkcje ──

test('wywołania testów i Probierza', () => {
  expect(testsArgv(['camp', 'forge'])).toEqual(['python3', 'tools/testing/run_tests.py', 'camp', 'forge'])
  expect(probierzArgv('/G', ['full_level', 'malbork', 'sword', '150000', '0'])).toEqual([
    '/G', '--headless', '--path', '.', '--script', 'res://tools/balance_spike/full_level.gd', '--', 'malbork', 'sword', '150000', '0',
  ])
  expect(() => probierzArgv('/G', [])).toThrow()
  expect(() => probierzArgv('/G', ['../zly'])).toThrow()
  expect(splitArgs('wave_matrix malbork /tmp/wm.json "sword;sword:edge"')).toEqual([
    'wave_matrix', 'malbork', '/tmp/wm.json', 'sword;sword:edge',
  ])
})

test('postęp z wyjścia run_tests.py', () => {
  const base: Job = {
    id: 'x', label: 'testy', kind: 'testy', byClaude: false, startedAt: 0, endedAt: null, code: null, total: null,
    passed: 0, failed: 0, failedNames: [], lastLine: '', logPath: null, hidden: false,
  }
  let j = readLine(base, 'Testy: 3, równolegle: 4, projekt: /p')
  j = readLine(j, '  PASS  test_camp                            12.1s')
  j = readLine(j, '  FAIL  test_forge                            3.0s  [exit 1] log: x.log')
  expect([j.total, j.passed, j.failed, j.failedNames]).toEqual([3, 1, 1, ['test_forge']])
  expect(jobLine(j, 75_000)).toBe('⧗ testy · 1:15 · 1/3 ✓ · 1 ✗')
  expect(jobLine({ ...j, endedAt: 90_000, code: 1 }, 0)).toBe('✗ testy · 1:30 · 1/3 ✓ · 1 ✗ — test_forge')
  expect(clock(3_725_000)).toBe('1:02:05')
})

// ── Zachowanie w sesji ──

for (const surface of SURFACES) {
  test(`${surface}: panel decyzji — Przyjmij zapisuje do pliku`, async ($, on) => {
    const files: Record<string, string> = { 'docs/decyzje.md': FILE }
    disk(on, files)
    mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-decyzje' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('D-001 · Utonięcie = zabicie dokładne')
    expect(drawn).toContain('D-002 · Zastępnik herbu Polski  (pytanie)')
    expect(drawn).not.toContain('D-003')
    // Pytanie nie ma przycisków Przyjmij/Odrzuć — tylko pole odpowiedzi.
    expect(await ui.find({ key: 'ok-D-002' })).toBeUndefined()

    await ui.press({ key: 'ok-D-001' })
    expect(parseDecisions(files['docs/decyzje.md'] ?? '')[0]).toMatchObject({ status: 'przyjęta' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('D-001 · Utonięcie')
    expect(await ui.find({ key: 'kokpit-apply' })).toBeDefined()
  })

  test(`${surface}: odpowiedź na pytanie i „Wprowadź do dokumentów”`, async ($, on) => {
    const files: Record<string, string> = { 'docs/decyzje.md': FILE }
    disk(on, files)
    mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    const sent: string[] = []
    on('prompt.submit', async (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    on('ui.close', () => ({ value: undefined }))
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-decyzje' })
    await ui.input({ key: 'in-D-002', text: 'Herb Leliwa' })
    const d2 = parseDecisions(files['docs/decyzje.md'] ?? '')[1]
    expect(d2).toMatchObject({ status: 'przyjęta' })
    expect(d2?.fields['odpowiedź']).toBe('Herb Leliwa')

    await ui.press({ key: 'kokpit-apply' })
    expect(sent[0]).toContain('D-002 · Zastępnik herbu Polski: przyjęta — odpowiedź: „Herb Leliwa”')
  })

  test(`${surface}: /testy w tle — postęp w pasku i wynik`, async ($, on) => {
    const files: Record<string, string> = {}
    disk(on, files)
    const clk = mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    on('session.measure', async (_$, e) => ({ changed: e.changed }))
    on('ui.toast', () => ({ value: undefined }))
    let argv: readonly string[] = []
    on('process.spawn', async function* (_$, e) {
      argv = e.argv
      yield { stream: 'stdout' as const, text: '__KOKPIT_PID__ 4242\nTesty: 2, równolegle: 2, projekt: /p\n' }
      yield { stream: 'stdout' as const, text: '  PASS  test_camp   3.0s\n  FAIL  test_forge   1.0s  [exit 1]\n' }
      yield { stream: 'stdout' as const, text: '\n1/2 zaliczonych w 4 s\n' }
      return { value: { code: 1, signal: null } }
    })
    await $.session.measure({
      context: { tokens: 10_000, window: 200_000, percent: 5 },
      rateLimits: [],
      changed: ['context'],
    })
    const reply = await $.command.run({ command: 'testy', args: 'camp forge' } as never)
    expect(reply.text).toContain('w tle')
    await clk.advance(5000)
    expect(argv.slice(-4)).toEqual(['python3', 'tools/testing/run_tests.py', 'camp', 'forge'])
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('✗ testy camp forge')
    expect(drawn).toContain('1/2 ✓ · 1 ✗ — test_forge')
    expect(Object.keys(files).some(f => f.includes('.claude/kokpit/tlo/') && f.endsWith('.log'))).toBe(true)
    // Uruchomione przez użytkownika: wynik czeka na przycisk, Claude go sam nie dostaje.
    expect(drawn).toContain('Pokaż Claude')
  })

  test(`${surface}: narzędzie w_tle wraca od razu, wynik idzie do Claude`, async ($, on) => {
    disk(on, {})
    const clk = mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
    on('env.get', () => ({ value: undefined }))
    const sent: string[] = []
    on('prompt.submit', async (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    let argv: readonly string[] = []
    on('process.spawn', async function* (_$, e) {
      argv = e.argv
      yield { stream: 'stdout' as const, text: 'stany: 157031\nmin. obrażeń: 0, tur: 86\n' }
      return { value: { code: 0, signal: null } }
    })
    const r = await $.tool.call({
      tool: 'mcp__kokpit__w_tle',
      rodzaj: 'probierz',
      argumenty: 'full_level malbork sword 5000000 0',
      opis: 'Probierz Malbork',
    } as never)
    expect(String((r as { result?: unknown }).result)).toContain('Uruchomione w tle')
    await clk.advance(2000)
    expect(argv).toContain('res://tools/balance_spike/full_level.gd')
    expect(argv).toContain('/Applications/Godot.app/Contents/MacOS/Godot')
    expect(sent[0]).toContain('Zadanie w tle „Probierz Malbork” skończyło się powodzeniem')
    expect(sent[0]).toContain('min. obrażeń: 0, tur: 86')
  })
}
