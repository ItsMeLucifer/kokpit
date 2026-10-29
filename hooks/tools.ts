// Per-repo tools (the /tools pane): the graphify code graph and skills hidden from the model.
// Pure functions; process and file calls live in register.tsx.

/** The `skillOverrides` value that hides a skill from the model but keeps /name working. */
export const HIDDEN = 'user-invocable-only'

/** Prefix of skills synced from the claude.ai account; settings look them up by full and bare name. */
const SYNCED_PREFIX = 'anthropic-skills:'

/** Share of code in the graph from `setup.py graph` output ("code in graph: 26% (threshold 60%)"). */
export function parseShare(stdout: string): number | null {
  const m = /code in graph:\s*(\d+)%/.exec(stdout)
  return m ? Number(m[1]) / 100 : null
}

/** Settings keys for a skill: an account skill has a full and a bare name (different sources read different ones). */
export function overrideKeys(name: string): string[] {
  return name.startsWith(SYNCED_PREFIX) ? [name, name.slice(SYNCED_PREFIX.length)] : [name]
}

/** Names of skills hidden in the project settings (a full/bare pair counted once). */
export function hiddenSkills(overrides: Record<string, unknown> | undefined): string[] {
  const names = Object.entries(overrides ?? {})
    .filter(([, v]) => v === HIDDEN || v === 'off')
    .map(([k]) => k)
  return names.filter(n => n.startsWith(SYNCED_PREFIX) || !names.includes(SYNCED_PREFIX + n)).sort()
}

/**
 * New .claude/settings.json text with a skill hidden or restored; other settings unchanged.
 * Throws when the file is not valid JSON (then nothing is overwritten).
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
