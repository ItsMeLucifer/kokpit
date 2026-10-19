// Narzędzia per repo (panel /narzedzia): graf kodu graphify i skille ukryte przed modelem.
// Czyste funkcje — wywołania procesów i plików są w register.tsx.

/** Wartość `skillOverrides`, która ukrywa skill przed modelem, a zostawia /nazwa. */
export const HIDDEN = 'user-invocable-only'

/** Prefiks skilli z konta claude.ai; ustawienia szukają ich i po pełnej, i po gołej nazwie. */
const SYNCED_PREFIX = 'anthropic-skills:'

/** Udział kodu w grafie z wyjścia `zestaw.py graf` („udział kodu w grafie: 26% (próg 60%)”). */
export function parseShare(stdout: string): number | null {
  const m = /udział kodu w grafie:\s*(\d+)%/.exec(stdout)
  return m ? Number(m[1]) / 100 : null
}

/** Klucze ustawień dla skilla: skill z konta — pełna i goła nazwa (różne źródła ustawień czytają różne). */
export function overrideKeys(name: string): string[] {
  return name.startsWith(SYNCED_PREFIX) ? [name, name.slice(SYNCED_PREFIX.length)] : [name]
}

/** Nazwy skilli ukrytych w ustawieniach projektu (bez par pełna/goła nazwa podwójnie). */
export function hiddenSkills(overrides: Record<string, unknown> | undefined): string[] {
  const names = Object.entries(overrides ?? {})
    .filter(([, v]) => v === HIDDEN || v === 'off')
    .map(([k]) => k)
  return names.filter(n => n.startsWith(SYNCED_PREFIX) || !names.includes(SYNCED_PREFIX + n)).sort()
}

/**
 * Nowy tekst .claude/settings.json z ukrytym albo przywróconym skillem; reszta ustawień bez zmian.
 * Rzuca, gdy plik nie jest poprawnym JSON-em (wtedy niczego nie nadpisujemy).
 */
export function withSkill(settingsText: string | null, name: string, hide: boolean): string {
  const settings = settingsText && settingsText.trim() ? (JSON.parse(settingsText) as Record<string, unknown>) : {}
  const current = settings.skillOverrides
  const overrides: Record<string, unknown> =
    current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {}
  for (const key of overrideKeys(name)) {
    if (hide) overrides[key] = HIDDEN
    else delete overrides[key]
  }
  if (Object.keys(overrides).length > 0) settings.skillOverrides = overrides
  else delete settings.skillOverrides
  return JSON.stringify(settings, null, 2) + '\n'
}
