"""Kokpit setup helper (called by setup.sh). Standard library only.

  setup.py settings <settings.json> <profile.json> [--check] [--overwrite]
      Merges the profile into the Claude Code settings: adds missing keys, only reports differing ones
      (replaces them with --overwrite). Writes a copy next to the file first. With --check nothing is written.
  setup.py graph <project> <extensions.txt>
      How much of the project's code graphify's AST parser reads and how much stays out of the graph. Exit 0 = fits.
  setup.py sizes <project>
      Fixed per-session cost of project files: CLAUDE.md/AGENTS.md with imports (loaded in full) and handoff threads.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

# Code extensions graphify does not know, counted to show what stays out of the graph.
# (graphify reads .json, .sh and .md, but they are not "project code", so they do not count towards the share.)
UNSUPPORTED_CODE = {
    'gd', 'gdshader', 'gdshaderinc', 'tscn', 'tres', 'shader', 'glsl', 'hlsl', 'wgsl', 'hx', 'nim', 'cr', 'odin', 'gleam',
}
AUXILIARY = {'json', 'sh', 'bash', 'md', 'txt', 'yaml', 'yml', 'html'}
GRAPH_THRESHOLD = 0.6
# Estimate: about 3 UTF-8 bytes per token (a conservative figure that also covers text with diacritics).
BYTES_PER_TOKEN = 3
ENTRY_LINE_LIMIT = 200  # the Claude Code documentation's recommendation for memory files
LARGE_THREAD = 20_000
ARCHIVE_SUFFIXES = ('.archive.md', '.archiwum.md')


def settings(target_path: str, profile_path: str, check: bool, overwrite: bool) -> int:
    target_file = Path(target_path).expanduser()
    target = json.loads(target_file.read_text()) if target_file.exists() else {}
    profile = json.loads(Path(profile_path).read_text())
    profile = {k: v for k, v in profile.items() if not k.startswith('_')}
    added: list[str] = []
    differing: list[tuple[str, object, object]] = []

    def merge(t: dict, p: dict, path: str) -> None:
        for k, v in p.items():
            key = f'{path}.{k}' if path else k
            if k not in t:
                t[k] = v
                added.append(key)
            elif isinstance(v, dict) and isinstance(t[k], dict):
                merge(t[k], v, key)
            elif t[k] != v:
                differing.append((key, t[k], v))
                if overwrite:
                    t[k] = v

    merge(target, profile, '')
    for k in added:
        print(f'  + {k}')
    for k, current, wanted in differing:
        mark = '~' if overwrite else '≠'
        print(f'  {mark} {k}: is {json.dumps(current, ensure_ascii=False)}, profile {json.dumps(wanted, ensure_ascii=False)}')
    changed = bool(added) or (overwrite and bool(differing))
    if not added and not differing:
        print('  matches the profile')
    if check or not changed:
        return 0
    if target_file.exists():
        # Two writes in the same second must not overwrite the first copy (it holds the original).
        stamp = time.strftime('%Y%m%d-%H%M%S')
        backup = target_file.with_name(f'{target_file.name}.kokpit-{stamp}')
        n = 1
        while backup.exists():
            n += 1
            backup = target_file.with_name(f'{target_file.name}.kokpit-{stamp}-{n}')
        shutil.copy2(target_file, backup)
        print(f'  backup: {backup}')
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(json.dumps(target, ensure_ascii=False, indent=2) + '\n')
    print(f'  wrote {target_file}')
    return 0


def project_files(project: Path) -> list[str]:
    try:
        r = subprocess.run(['git', '-C', str(project), 'ls-files'], capture_output=True, text=True, check=True)
        return r.stdout.splitlines()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [str(p.relative_to(project)) for p in project.rglob('*') if p.is_file() and '.git' not in p.parts]


def graph(project_path: str, extensions_path: str) -> int:
    project = Path(project_path)
    known = {
        l.strip().lstrip('.').lower()
        for l in Path(extensions_path).read_text().splitlines()
        if l.strip() and not l.startswith('#')
    }
    counts = Counter(Path(p).suffix.lstrip('.').lower() for p in project_files(project) if Path(p).suffix)
    reads = {e: n for e, n in counts.items() if e in known and e not in AUXILIARY}
    skips = {e: n for e, n in counts.items() if e in UNSUPPORTED_CODE}
    total = sum(reads.values()) + sum(skips.values())
    share = sum(reads.values()) / total if total else 0.0

    def describe(d: dict) -> str:
        return ', '.join(f'.{e} {n}' for e, n in sorted(d.items(), key=lambda x: -x[1])) or '—'

    print(f'  reads (AST, no LLM): {describe(reads)}')
    print(f'  stays out:           {describe(skips)}')
    print(f'  code in graph: {share:.0%} (threshold {GRAPH_THRESHOLD:.0%})')
    return 0 if total and share >= GRAPH_THRESHOLD else 1


def imports(path: Path, depth: int = 0, seen=None) -> list:
    """Files pulled in with @ (Claude Code loads them together with CLAUDE.md, up to 5 levels)."""
    seen = [] if seen is None else seen
    text = re.sub(r'```.*?```', '', path.read_text(errors='replace'), flags=re.S)
    for m in re.finditer(r'(?:^|\s)@([\w./\-]+\.md)\b', re.sub(r'`[^`\n]*`', '', text)):
        target = (path.parent / m.group(1)).resolve()
        if target.exists() and target not in seen and depth < 5:
            seen.append(target)
            imports(target, depth + 1, seen)
    return seen


def sizes(project_path: str) -> int:
    project = Path(project_path)
    root = project.resolve()
    # Claude Code loads these in full at the start of every session (and every subagent except Explore/Plan).
    # On macOS .claude/CLAUDE.md and .claude/CLAUDE.MD are the same file, and AGENTS.md is often a link: count once.
    # The key is the inode: on macOS resolve() does not normalize case (CLAUDE.md vs CLAUDE.MD).
    seen: dict[tuple[int, int], str] = {}

    def inode(p: Path) -> tuple[int, int]:
        st = p.stat()
        return st.st_dev, st.st_ino

    for name in ('CLAUDE.md', '.claude/CLAUDE.md', '.claude/CLAUDE.MD', 'CLAUDE.local.md'):
        path = project / name
        if not path.exists() or inode(path) in seen:
            continue
        seen[inode(path)] = name
        size = path.stat().st_size
        lines = path.read_text(errors='replace').count('\n')
        mark = '!' if lines > ENTRY_LINE_LIMIT else '✓'
        print(f'  {mark} {name}: {lines} lines, {size // 1024} KB ≈ {size // BYTES_PER_TOKEN // 1000}k tokens in every session')
        for imp in imports(path):
            b = imp.stat().st_size
            shown = imp.relative_to(root) if imp.is_relative_to(root) else imp
            print(f'    + @{shown}: {b // 1024} KB ≈ {b // BYTES_PER_TOKEN // 1000}k tokens (import)')
    agents = project / 'AGENTS.md'
    if agents.exists():
        if inode(agents) in seen:
            print(f'  ✓ AGENTS.md: the same file as {seen[inode(agents)]} (for other agents; Claude Code counts it once)')
        else:
            print(f'  ✓ AGENTS.md: {agents.stat().st_size // 1024} KB (Claude Code reads it only when there is no CLAUDE.md)')
    # Archive files are read by /resume only when something is missing: they do not count towards the cost.
    threads = sorted(
        (p for p in (project / '.claude/handoffs').glob('*.md') if not p.name.endswith(ARCHIVE_SUFFIXES)),
        key=lambda p: -p.stat().st_size,
    )
    if threads:
        large = [p for p in threads if p.stat().st_size > LARGE_THREAD]
        print(f'  handoff threads: {len(threads)}, {sum(p.stat().st_size for p in threads) // 1024} KB in total')
        for p in large[:5]:
            kb = p.stat().st_size
            print(f'  ! {p.name}: {kb // 1024} KB ≈ {kb // BYTES_PER_TOKEN // 1000}k tokens at every /resume')
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd, args = argv[1], [a for a in argv[2:] if not a.startswith('--')]
    flags = {a for a in argv[2:] if a.startswith('--')}
    if cmd == 'settings' and len(args) == 2:
        return settings(args[0], args[1], '--check' in flags, '--overwrite' in flags)
    if cmd == 'graph' and len(args) == 2:
        return graph(args[0], args[1])
    if cmd == 'sizes' and len(args) == 1:
        return sizes(args[0])
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
