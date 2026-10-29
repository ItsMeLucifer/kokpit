"""The Kokpit repo standard (docs/repo-standard.md in the Kokpit repo). Standard library only; called by setup.sh.

  standard.py state <project> [--json]
      State of the repo: A (empty), B (Claude without the standard), C (compliant) and what is missing. Changes nothing.
  standard.py init <project> --project NAME --owner "First Last" --github LOGIN [--description TEXT] [--lang en|pl] [--github-module]
      Creates the missing skeleton files (never overwrites): core, project templates, AGENTS.md, hook, .gitignore,
      manifest. It does not lock anything: after filling in 10-project.md run sh tools/docs/lock_org_rules.sh.
  standard.py core <project> [--write]
      The repo's core files against Kokpit's version. With --write, copies the newer ones (old differing files go to
      docs/archive/standard-<date>/) and recomputes the manifest. Locked files need the Owner's --unlock first.
  standard.py rename-entry <project>
      .claude/CLAUDE.MD (and other case variants) -> .claude/CLAUDE.md, the AGENTS.md link; lists the files that still
      mention the old name.
  standard.py archive <project> <path>...
      Moves files to docs/archive/standard-<date>/ (git mv when tracked). A migration never deletes anything.
  standard.py hook <project>
      Adds the PostToolUse hook with check_docs.py to the project's .claude/settings.json.
  standard.py audit <project> [--json]
      Harness audit (skills/setup/harness-audit.md): for each question, what the repo shows (✓ covered, ~ partial,
      ✗ missing, ? only the Owner can say, – not applicable). Changes nothing. Works on any repo, standard or not.
  standard.py audit <project> --record <item> answered|n/a|clear "<note>"
      Records the Owner's answer or exclusion in tools/docs/standard.json; answers count for 180 days.

The standard comes in English and Polish. A repo keeps the language it already follows; a new one gets --lang.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STANDARD = HERE.parent / 'standard'
SHARED_CORE = STANDARD / 'core'
GITHUB = STANDARD / 'github'
VERSION = (STANDARD / 'VERSION').read_text().strip()
HOOK_CMD = 'python3 "$CLAUDE_PROJECT_DIR/tools/docs/check_docs.py" --hook'
EXECUTABLE = {'tools/docs/check_docs.py', 'tools/docs/lock_org_rules.sh'}
LANGUAGES = ('en', 'pl')
PROJECT_FILE = {'en': '10-project.md', 'pl': '10-projekt.md'}
REGISTER = {'en': 'docs/decisions.md', 'pl': 'docs/decyzje.md'}
ARCHIVE_DIR = {'en': 'docs/archive', 'pl': 'docs/archiwum'}
# Template placeholders per language: (project, owner, GitHub login, description).
PLACEHOLDERS = {
    'en': ('PROJECT', 'OWNER', 'GITHUB', 'DESCRIPTION'),
    'pl': ('PROJEKT', 'WLASCICIEL', 'GITHUB', 'OPIS'),
}


def files(base: Path) -> list[str]:
    """Target paths in the repo. Dot directories live in Kokpit as dot-<name> (remote tools and Claude Code treat
    .claude/ and .github/ specially, and the entry template must not load while working on Kokpit itself)."""
    return sorted('/'.join('.' + c[4:] if c.startswith('dot-') else c for c in p.relative_to(base).parts)
                  for p in base.rglob('*') if p.is_file())


def source(base: Path, rel: str) -> Path:
    return base.joinpath(*('dot-' + c[1:] if c.startswith('.') else c for c in Path(rel).parts))


def core_sources(lang: str) -> list[tuple[str, Path]]:
    """(target path, source) for every core file of the language: shared code plus the language's texts."""
    out = [(rel, source(SHARED_CORE, rel)) for rel in files(SHARED_CORE)]
    lang_core = STANDARD / lang / 'core'
    return sorted(out + [(rel, source(lang_core, rel)) for rel in files(lang_core)])


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def core_version(p: Path) -> str | None:
    if not p.exists():
        return None
    m = re.search(r'^(?:#\s*|<!--\s*)?(?:core|rdzen):\s*([\w.]+)', p.read_text(errors='ignore'), re.M)
    return m.group(1) if m else None


def git(project: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['git', '-C', str(project), *args], capture_output=True, text=True)


def tracked(project: Path, rel: str) -> bool:
    return git(project, 'ls-files', '--error-unmatch', rel).returncode == 0


def writable(p: Path) -> bool:
    """By permission bits, not os.access: root (CI, containers) writes despite chmod a-w, and the lock must behave the same."""
    target = p if p.exists() else p.parent
    while not target.exists():
        target = target.parent
    return bool(target.stat().st_mode & 0o200) and (target.is_dir() or bool(target.parent.stat().st_mode & 0o200))


def repo_language(project: Path, wanted: str | None = None) -> str:
    """The language the repo already follows; otherwise the requested one (English by default)."""
    org = project / '.claude' / 'org-rules'
    names = set(os.listdir(org)) if org.is_dir() else set()
    if '10-projekt.md' in names or any(n.startswith('00-rdzen-') for n in names):
        return 'pl'
    if '10-project.md' in names or any(n.startswith('00-core-') for n in names):
        return 'en'
    return wanted if wanted in LANGUAGES else 'en'


def archive_dir(project: Path, lang: str) -> Path:
    return project / ARCHIVE_DIR[lang] / f'standard-{time.strftime("%Y-%m-%d")}'


def move(project: Path, rel: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if tracked(project, rel) and git(project, 'mv', rel, str(target.relative_to(project))).returncode == 0:
        return
    shutil.move(str(project / rel), str(target))


# --- state -------------------------------------------------------------------------------------------

def entries(project: Path) -> list[str]:
    found = []
    for directory in ('.claude', '.'):
        d = project / directory
        if d.is_dir():
            found += [os.path.normpath(f'{directory}/{n}') for n in os.listdir(d) if n.lower() == 'claude.md']
    if (project / 'AGENTS.md').exists() and not (project / 'AGENTS.md').is_symlink():
        found.append('AGENTS.md')
    return found


def has_hook(project: Path) -> bool:
    try:
        data = json.loads((project / '.claude' / 'settings.json').read_text())
    except (OSError, ValueError):
        return False
    return any(HOOK_CMD in h.get('command', '') for e in data.get('hooks', {}).get('PostToolUse', []) for h in e.get('hooks', []))


def state(project: Path, wanted: str | None = None) -> dict:
    lang = repo_language(project, wanted)
    org = project / '.claude' / 'org-rules'
    found = entries(project)
    repo_core = core_version(org / 'README.md')
    missing, notes = [], []
    core = core_sources(lang)
    for rel, _ in core:
        if not (project / rel).exists():
            missing.append(rel)
    for rel in ('.claude/CLAUDE.md', f'.claude/org-rules/{PROJECT_FILE[lang]}', 'docs/README.md', REGISTER[lang],
                'tools/docs/standard.json', '.claude/org-rules/MANIFEST.sha256'):
        if not (project / rel).exists():
            missing.append(rel)
    agents = project / 'AGENTS.md'
    if not (agents.is_symlink() and agents.resolve() == (project / '.claude' / 'CLAUDE.md').resolve()):
        missing.append('AGENTS.md -> .claude/CLAUDE.md')
    if not has_hook(project):
        missing.append('.claude/settings.json: PostToolUse hook for check_docs')
    ignored = (project / '.gitignore').read_text(errors='ignore').splitlines() if (project / '.gitignore').exists() else []
    for line in (STANDARD / 'gitignore.txt').read_text().splitlines():
        if line and not line.startswith('#') and line not in ignored:
            missing.append(f'.gitignore: {line}')
    for e in found:
        if e != '.claude/CLAUDE.md':
            notes.append(f'{e}: an entry outside the standard (target: .claude/CLAUDE.md, with AGENTS.md in the root as a link)')
    if org.is_dir():
        other = [n for n in sorted(os.listdir(org)) if n.endswith('.md') and n != 'README.md'
                 and not re.match(r'(00-core-|00-rdzen-|1\d-)', n)]
        if other:
            notes.append('org-rules outside the 00-core-*/1x-project* layout: ' + ', '.join(other))
    if repo_core and repo_core != VERSION:
        notes.append(f'core in the repo is {repo_core}, Kokpit has {VERSION}: standard.py core (an update to propose)')
    stale = [rel for rel, _ in core if (project / rel).exists() and not core_version(project / rel)]
    if stale:
        notes.append('project files where core files belong (no `core:` marker; standard.py core --write archives them): '
                     + ', '.join(stale))
    differing = [rel for rel, src in core if (project / rel).exists() and sha(project / rel) != sha(src)]
    if differing and repo_core:
        notes.append('core files differing from Kokpit: ' + ', '.join(differing))
    unfilled = [rel for rel in ('.claude/CLAUDE.md', f'.claude/org-rules/{PROJECT_FILE[lang]}')
                if re.search(r'\{\{[A-Z_]+\}\}', (project / rel).read_text(errors='ignore') if (project / rel).exists() else '')]
    if unfilled:
        notes.append('skeleton created, interview not finished: {{...}} in ' + ', '.join(unfilled))
    complete = repo_core is not None and all(not (m.startswith('.claude/org-rules/') and m.endswith('.md')) for m in missing)
    if (not found and not org.exists() and not (project / '.claude' / 'rules').exists()) or (unfilled and repo_core):
        s = 'A'
    elif complete and (org / PROJECT_FILE[lang]).exists():
        s = 'C'
    else:
        s = 'B'
    return {'state': s, 'language': lang, 'core_repo': repo_core, 'core_kokpit': VERSION, 'entries': found,
            'missing': missing, 'notes': notes, 'differing': differing}


STATE_TEXT = {
    'A': 'A · empty: a skeleton to create (standard.py init) or to fill in with the interview',
    'B': 'B · Claude without the standard: a difference report and a step-by-step migration, each step with consent',
    'C': 'C · compliant: only a check and possibly a core update',
}


def cmd_state(project: Path, as_json: bool, wanted: str | None) -> int:
    s = state(project, wanted)
    if as_json:
        print(json.dumps(s, ensure_ascii=False, indent=2))
        return 0
    print(f'  state: {STATE_TEXT[s["state"]]}')
    print(f'  language: {s["language"]} · core: repo {s["core_repo"] or "none"}, Kokpit {s["core_kokpit"]}')
    for m in s['missing']:
        print(f'  ✗ {m}')
    for n in s['notes']:
        print(f'  ! {n}')
    if (project / 'tools' / 'docs' / 'check_docs.py').exists() and s['state'] != 'A':
        r = subprocess.run([sys.executable, '-I', str(project / 'tools' / 'docs' / 'check_docs.py')], cwd=project,
                           capture_output=True, text=True)
        lines = (r.stdout + r.stderr).strip().splitlines()
        print('  check_docs: ' + (lines[-1] if lines else f'exit {r.returncode}'))
        for line in lines[:-1][:15]:
            print(f'    {line}')
        if len(lines) > 16:
            print(f'    … (+{len(lines) - 16}; all of it: python3 tools/docs/check_docs.py)')
    lock = project / 'tools' / 'docs' / 'lock_org_rules.sh'
    if lock.exists():
        r = subprocess.run(['sh', str(lock), '--status'], cwd=project, capture_output=True, text=True)
        print('  protection: ' + ' · '.join(r.stdout.strip().splitlines()))
    return 0


# --- init --------------------------------------------------------------------------------------------

def merge_hook(project: Path, lang: str) -> bool:
    path = project / '.claude' / 'settings.json'
    try:
        data = json.loads(path.read_text()) if path.exists() else {}
    except ValueError:
        print(f'  ✗ {path}: invalid JSON, hook skipped')
        return False
    if has_hook(project):
        return False
    template = json.loads(source(STANDARD / lang / 'project', '.claude/settings.json').read_text())['hooks']['PostToolUse'][0]
    data.setdefault('hooks', {}).setdefault('PostToolUse', []).append(template)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        shutil.copy2(path, path.with_suffix('.json.bak'))
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    return True


def append_gitignore(project: Path) -> list[str]:
    path = project / '.gitignore'
    present = path.read_text().splitlines() if path.exists() else []
    block = (STANDARD / 'gitignore.txt').read_text().splitlines()
    new = [l for l in block if l and not l.startswith('#') and l not in present]
    if new:
        text = path.read_text() if path.exists() else ''
        if text and not text.endswith('\n'):
            text += '\n'
        header = [l for l in block if l.startswith('# ----')]
        path.write_text(text + ('\n' if text else '') + '\n'.join(header + new) + '\n')
    return new


def write_manifest(project: Path) -> None:
    org = project / '.claude' / 'org-rules'
    lines = [f'{sha(org / n)}  {n}' for n in sorted(os.listdir(org)) if n != 'MANIFEST.sha256' and not n.startswith('.')]
    (org / 'MANIFEST.sha256').write_text('\n'.join(lines) + '\n')


def render(text: str, values: dict) -> str:
    for key, value in values.items():
        if value is not None:
            text = text.replace('{{' + key + '}}', value)
    return text


def cmd_init(project: Path, opts: dict) -> int:
    for key in ('project', 'owner', 'github'):
        if not opts.get(key):
            print(f'  ✗ missing --{key}')
            return 2
    bad_name = [n for n in entries(project) if n.startswith('.claude/') and n != '.claude/CLAUDE.md']
    if bad_name:
        print(f'  ✗ rename the entry first: standard.py rename-entry {project} ({", ".join(bad_name)})')
        return 2
    lang = repo_language(project, opts.get('lang'))
    names = PLACEHOLDERS[lang]
    values = dict(zip(names, (opts['project'], opts['owner'], opts['github'], opts.get('description'))))
    values['GITHUB'] = opts['github']
    sources = [(rel, src, False) for rel, src in core_sources(lang)]
    project_templates = STANDARD / lang / 'project'
    sources += [(rel, source(project_templates, rel), True) for rel in files(project_templates)]
    if 'github-module' in opts:
        sources += [(rel, source(GITHUB, rel), True) for rel in files(GITHUB)]
    for rel, src, template in sources:
        if rel == '.claude/settings.json':
            continue
        target = project / rel
        if target.exists():
            print(f'  · {rel} already exists (unchanged)')
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        text = src.read_text()
        target.write_text(render(text, values) if template else text)
        if rel in EXECUTABLE:
            target.chmod(0o755)
        print(f'  + {rel}')
    agents = project / 'AGENTS.md'
    if not agents.exists() and not agents.is_symlink():
        agents.symlink_to('.claude/CLAUDE.md')
        print('  + AGENTS.md -> .claude/CLAUDE.md')
    elif not agents.is_symlink():
        print('  ! AGENTS.md is a regular file: move its content, then standard.py archive it and run again')
    if merge_hook(project, lang):
        print('  + .claude/settings.json: PostToolUse hook for check_docs')
    for line in append_gitignore(project):
        print(f'  + .gitignore: {line}')
    (project / '.claude' / 'handoffs').mkdir(parents=True, exist_ok=True)
    if writable(project / '.claude' / 'org-rules' / 'MANIFEST.sha256'):
        write_manifest(project)
        print('  + .claude/org-rules/MANIFEST.sha256 recomputed')
    print(f'  Next: fill in {{{{...}}}} in .claude/org-rules/{PROJECT_FILE[lang]} and .claude/CLAUDE.md (the interview), then'
          ' python3 tools/docs/check_docs.py --write-manifest, python3 tools/docs/check_docs.py, sh tools/docs/lock_org_rules.sh')
    return 0


# --- core --------------------------------------------------------------------------------------------

def cmd_core(project: Path, write: bool) -> int:
    lang = repo_language(project)
    changes = []
    for rel, src in core_sources(lang):
        target = project / rel
        if not target.exists():
            changes.append((rel, src, 'new'))
        elif sha(target) != sha(src):
            old = core_version(target)
            changes.append((rel, src, f'{old or "no core marker"} -> {VERSION}' if old != VERSION else 'changed against Kokpit'))
    if not changes:
        print(f'  ✓ core matches Kokpit ({VERSION}, {lang})')
        return 0
    for rel, _, what in changes:
        print(f'  {"~" if write else "≠"} {rel}: {what}')
    if not write:
        print(f'  Diff: diff -u <repo>/<file> {STANDARD}/… (dot directories as dot-…). Write: standard.py core <project> --write')
        return 1
    locked = [rel for rel, _, _ in changes if not writable(project / rel)]
    if locked:
        print('  ✗ locked: ' + ', '.join(locked))
        print('    The Owner, in their own terminal: sh tools/docs/lock_org_rules.sh --unlock')
        return 3
    archive = archive_dir(project, lang)
    for rel, src, what in changes:
        target = project / rel
        if target.exists():
            (archive / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, archive / rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
        if rel in EXECUTABLE:
            target.chmod(0o755)
    if any(rel.startswith('.claude/org-rules/') for rel, _, _ in changes):
        write_manifest(project)
        print('  + MANIFEST.sha256 recomputed')
    if any(what != 'new' for _, _, what in changes):
        print(f'  Previous versions: {archive.relative_to(project)}/')
    print('  Next: python3 tools/docs/check_docs.py, then sh tools/docs/lock_org_rules.sh')
    return 0


# --- migration ---------------------------------------------------------------------------------------

def cmd_rename_entry(project: Path) -> int:
    directory = project / '.claude'
    wrong = [n for n in os.listdir(directory) if n.lower() == 'claude.md' and n != 'CLAUDE.md'] if directory.is_dir() else []
    if not wrong:
        print('  ✓ .claude/CLAUDE.md has the right name')
    for n in wrong:
        tmp = f'.claude/{n}.rename'
        for a, b in ((f'.claude/{n}', tmp), (tmp, '.claude/CLAUDE.md')):  # two steps: case-insensitive file systems
            if not (tracked(project, a) and git(project, 'mv', a, b).returncode == 0):
                os.rename(project / a, project / b)
        print(f'  ~ .claude/{n} -> .claude/CLAUDE.md')
    agents = project / 'AGENTS.md'
    if agents.is_symlink() and os.readlink(agents) != '.claude/CLAUDE.md':
        agents.unlink()
        agents.symlink_to('.claude/CLAUDE.md')
        print('  ~ AGENTS.md -> .claude/CLAUDE.md')
    old = set(wrong) or {'CLAUDE.MD'}
    r = git(project, 'grep', '-l', '-e', '|'.join(re.escape(s) for s in old), '-E', '--', '.', ':!docs/archive', ':!docs/archiwum')
    for line in r.stdout.splitlines():
        print(f'  ! {line}: mentions the old name')
    return 0


def cmd_archive(project: Path, paths: list[str]) -> int:
    archive = archive_dir(project, repo_language(project))
    for rel in paths:
        rel = os.path.relpath(os.path.abspath(project / rel), project)
        if not (project / rel).exists():
            print(f'  ✗ {rel}: does not exist')
            continue
        move(project, rel, archive / rel)
        print(f'  ~ {rel} -> {(archive / rel).relative_to(project)}')
    return 0


# --- harness audit -----------------------------------------------------------------------------------
# Evidence for the questions in skills/setup/harness-audit.md. The script only reports what it can see in the repo;
# the setup skill asks the Owner about everything marked ✗, ~ or ?.

AUDIT_ITEMS = [
    ('what', 'What is this system?'),
    ('layout', 'How is it organized?'),
    ('run', 'How do I run it?'),
    ('verify', 'How do I verify it?'),
    ('now', 'Where are we now?'),
    ('near-code', 'Is area knowledge next to the code?'),
    ('outside', 'What knowledge lives outside the repo?'),
    ('protected', 'What must the agent not touch or pay for?'),
    ('pins', 'Are tool and runtime versions pinned?'),
    ('feedback', 'Does the feedback run without being asked?'),
    ('decay', 'Is the written knowledge still true?'),
    ('work-units', 'What is a unit of work, and when is it done?'),
]
MARKS = {'ok': '✓', 'partial': '~', 'missing': '✗', 'ask': '?', 'na': '–'}
# Answers recorded with --record count for this many days; after that the question comes back (knowledge decays).
ANSWER_DAYS = 180
SECTIONS = {
    'summary': ('Project summary', 'Skrót projektu'),
    'environment': ('Stack and environment', 'Stos i środowisko'),
    'verification': ('Verification', 'Weryfikacja'),
    'protected': ('Protected', 'Nietykalne'),
}
ENTRY_DEFAULT_ROWS = 5  # rows of the "Where things are" table that come with the template
RUN_FILES = ('Makefile', 'justfile', 'Taskfile.yml', 'package.json', 'pubspec.yaml', 'pyproject.toml', 'setup.py',
             'Cargo.toml', 'go.mod', 'project.godot', 'build.gradle', 'build.gradle.kts', 'pom.xml', 'CMakeLists.txt',
             'docker-compose.yml', 'compose.yaml', 'init.sh', 'Gemfile', 'mix.exs', '*.sln', '*.uproject')
PIN_FILES = ('.nvmrc', '.node-version', '.tool-versions', '.python-version', 'mise.toml', '.mise.toml',
             'rust-toolchain', 'rust-toolchain.toml', '.fvmrc', '.fvm/fvm_config.json', 'global.json', '.ruby-version',
             '.java-version', '.devcontainer/devcontainer.json', 'Dockerfile', 'flake.nix', 'uv.lock', 'poetry.lock',
             'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'pubspec.lock', 'Cargo.lock', 'go.sum')
PROGRESS_FILES = ('PROGRESS.md', 'ROADMAP.md', 'TODO.md', 'docs/progress.md', 'docs/roadmap.md', 'docs/postep.md')
NEAR_CODE_DOCS = ('README.md', 'ARCHITECTURE.md', 'CONSTRAINTS.md', 'CLAUDE.md', 'AGENTS.md')
LARGE_DIR = 20  # tracked files in a top-level directory that deserve their own knowledge next to the code


def section(text: str, names: tuple[str, ...]) -> str | None:
    m = re.search(r'^## (?:' + '|'.join(map(re.escape, names)) + r')[^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
    return m.group(1) if m else None


def filled(body: str | None) -> list[str]:
    """Meaningful lines of a section: no comments, templates, table headers or fences."""
    if body is None:
        return []
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    return [l.strip() for l in body.splitlines()
            if l.strip() and '{{' not in l and not l.strip().startswith(('```', '|---', '| Kind', '| Rodzaj', '| File', '| Plik'))]


def tracked_files(project: Path) -> list[str]:
    r = git(project, 'ls-files', '--cached', '--others', '--exclude-standard')
    if r.returncode == 0:
        return r.stdout.splitlines()
    return [str(p.relative_to(project)) for p in project.rglob('*') if p.is_file() and '.git' not in p.parts]


def rule_globs(project: Path) -> list[str]:
    globs = []
    for p in sorted((project / '.claude' / 'rules').rglob('*.md')):
        text = p.read_text(errors='ignore')
        fm = text.split('---', 2)[1] if text.startswith('---') and text.count('---') >= 2 else ''
        m = re.search(r'^paths:[ \t]*(.*?)(?=^[A-Za-z_][\w-]*:|\Z)', fm + '\n', re.M | re.S)
        if m:
            raw = m.group(1).strip()
            parts = raw.strip('[]').split(',') if not raw.startswith('-') else re.findall(r'^\s*-\s*(.+)$', raw, re.M)
            globs += [g.strip().strip('"\'') for g in parts if g.strip()]
    return globs


def exists_any(project: Path, names) -> list[str]:
    return sorted({str(p.relative_to(project)) for n in names for p in project.glob(n)})


def recorded(project: Path) -> dict:
    try:
        return json.loads((project / 'tools' / 'docs' / 'standard.json').read_text()).get('audit', {})
    except (OSError, ValueError):
        return {}


def audit(project: Path) -> dict:
    lang = repo_language(project)
    files = tracked_files(project)
    found = entries(project)
    entry_rel = '.claude/CLAUDE.md' if '.claude/CLAUDE.md' in found else (found[0] if found else None)
    entry = (project / entry_rel).read_text(errors='ignore') if entry_rel else ''
    pfile = project / '.claude' / 'org-rules' / PROJECT_FILE[lang]
    ptext = pfile.read_text(errors='ignore') if pfile.exists() else ''
    # Without the standard the sections may live in the entry itself.
    source_text = ptext + '\n' + entry
    rules_dir = project / '.claude' / 'rules'
    rule_text = ' '.join(p.read_text(errors='ignore') for p in rules_dir.rglob('*.md')) if rules_dir.is_dir() else ''
    docs_index = (project / 'docs' / 'README.md').read_text(errors='ignore') if (project / 'docs' / 'README.md').exists() else ''
    known = entry + rule_text + docs_index + ptext
    out = {}

    def put(key, status, evidence):
        out[key] = {'status': status, 'evidence': evidence}

    # what
    # The description is the text between the title and the first import or section.
    head = re.split(r'^(?:@|## )', re.sub(r'\A---\n.*?\n---\n', '', entry, flags=re.S), maxsplit=1, flags=re.M)[0]
    lines = [l for l in head.splitlines() if l.strip() and not l.startswith(('#', '<!--')) and '{{' not in l]
    if entry_rel and lines:
        put('what', 'ok', f'{entry_rel}: "{lines[0][:70]}"')
    elif (project / 'README.md').exists():
        put('what', 'partial', 'only README.md; the entry has no description')
    else:
        put('what', 'missing', 'no entry file and no README.md')

    # layout
    top = sorted({f.split('/')[0] for f in files if '/' in f and not f.startswith('.')})
    unmapped = [d for d in top if not re.search(r'(?<![\w.-])' + re.escape(d) + r'(?:/|`|\b)', known)]
    rows = len(re.findall(r'^\|\s*`', section(entry, ('Where things are', 'Gdzie co jest')) or '', re.M))
    if not entry_rel:
        put('layout', 'missing', 'no entry file with a map')
    elif unmapped:
        put('layout', 'partial', f'directories the map does not mention: {", ".join(unmapped[:8])}'
            + (f' (+{len(unmapped) - 8})' if len(unmapped) > 8 else ''))
    else:
        put('layout', 'ok', f'every top-level directory is mapped ({len(top)}; map rows {rows})')

    # run
    env = filled(section(source_text, SECTIONS['environment']))
    run_files = exists_any(project, RUN_FILES)
    if env:
        put('run', 'ok', f'"Stack and environment" filled ({len(env)} lines); run files: {", ".join(run_files) or "none"}')
    elif run_files:
        put('run', 'partial', f'run files exist ({", ".join(run_files[:5])}) but no "Stack and environment" section says how to use them')
    else:
        put('run', 'missing', 'no "Stack and environment" section and no recognised run files')

    # verify
    body = section(source_text, SECTIONS['verification'])
    blocks = re.findall(r'```(?:bash|sh)?\n(.*?)```', body or '', re.S)
    commands = [l.strip() for b in blocks for l in b.splitlines() if l.strip() and not l.strip().startswith('#') and '{{' not in l]
    dead = []
    for c in commands:
        for token in c.split():
            if '/' in token and not token.startswith(('-', '$', '~', 'http')) and not any(ch in token for ch in '*{}<>'):
                path = token.strip('"\'').split('::')[0]
                if not (project / path).exists() and not Path(path).is_absolute():
                    dead.append(path)
    ci = exists_any(project, ('.github/workflows/*.yml', '.github/workflows/*.yaml', '.gitlab-ci.yml', 'bitbucket-pipelines.yml'))
    try:
        tests = json.loads((project / '.claude' / 'kokpit.json').read_text()).get('tests')
    except (OSError, ValueError):
        tests = None
    if not commands:
        put('verify', 'missing', 'no verification commands' + (f' (kokpit.json tests: {tests})' if tests else ''))
    elif dead:
        put('verify', 'partial', f'{len(commands)} commands, but these paths do not exist: {", ".join(dead[:5])}')
    else:
        put('verify', 'ok', f'{len(commands)} commands' + (f'; /tests: {tests}' if tests else '; no "tests" in .claude/kokpit.json'))

    # now
    threads = [p for p in (project / '.claude' / 'handoffs').glob('*.md') if not p.name.endswith(('.archive.md', '.archiwum.md'))]
    register = [r for r in REGISTER.values() if (project / r).exists()]
    progress = exists_any(project, PROGRESS_FILES)
    evidence = f'handoff threads {len(threads)}, register {", ".join(register) or "none"}, progress files {", ".join(progress) or "none"}'
    put('now', 'ok' if threads or progress else 'partial' if register else 'missing', evidence)

    # near-code
    counts: dict[str, int] = {}
    for f in files:
        if '/' in f and not f.startswith('.'):
            counts[f.split('/')[0]] = counts.get(f.split('/')[0], 0) + 1
    globs = rule_globs(project)
    large = [d for d, n in counts.items() if n >= LARGE_DIR and d not in ('docs',)]
    bare = [d for d in sorted(large)
            if not any(g.startswith((d + '/', '**')) for g in globs)
            and not any((project / d / n).exists() for n in NEAR_CODE_DOCS)]
    if not large:
        put('near-code', 'ok', 'no large top-level directories')
    elif bare:
        put('near-code', 'partial', f'large directories without an area rule or a local doc: {", ".join(bare[:8])}')
    else:
        put('near-code', 'ok', f'{len(large)} large directories, each with an area rule or a local doc ({len(globs)} rule globs)')

    # outside: only the Owner knows
    put('outside', 'ask', 'decisions in chats, tickets, wikis or people\'s heads: only the Owner can say')

    # protected
    pbody = section(source_text, SECTIONS['protected'])
    m = re.search(r'```kokpit-(?:protected|nietykalne)\n(.*?)```', pbody or source_text, re.S)
    items = [l for l in (m.group(1).splitlines() if m else []) if l.strip() and not l.strip().startswith('#') and '{{' not in l]
    try:
        servers = sorted(json.loads((project / '.mcp.json').read_text()).get('mcpServers', {}))
    except (OSError, ValueError):
        servers = []
    unlisted = [s for s in servers if f'mcp__{s}' not in (m.group(1) if m else '')]
    if items and not unlisted:
        put('protected', 'ok', f'{len(items)} items in the protected list')
    elif items:
        put('protected', 'partial', f'{len(items)} items; project MCP servers not classified: {", ".join(unlisted)}')
    else:
        put('protected', 'ask', 'empty protected list: is there really no local data, manual work, generator or paid tool?')

    # pins
    pins = exists_any(project, PIN_FILES)
    mentions = re.findall(r'\b\d+\.\d+(?:\.\d+)?\b', '\n'.join(env))
    if pins and mentions:
        put('pins', 'ok', f'pinned in {", ".join(pins[:5])}; versions named in the project file')
    elif pins or mentions:
        put('pins', 'partial', ('pin files: ' + ', '.join(pins[:5])) if pins else 'versions only in text, no pin or lock file')
    else:
        put('pins', 'missing', 'no pin or lock files and no versions in the project file')

    # feedback
    hook = has_hook(project)
    parts = [f'check_docs hook {"yes" if hook else "no"}', f'CI {", ".join(ci) if ci else "none"}']
    put('feedback', 'ok' if hook and ci else 'partial' if hook or ci else 'missing', '; '.join(parts))

    # decay
    check = project / 'tools' / 'docs' / 'check_docs.py'
    if check.exists():
        r = subprocess.run([sys.executable, '-I', str(check)], cwd=project, capture_output=True, text=True)
        summary = ((r.stdout + r.stderr).strip().splitlines() or [''])[-1]
        n = re.search(r'(\d+) errors?, (\d+) warnings?', summary)
        bad = n and (int(n.group(1)) or int(n.group(2)))
        put('decay', 'partial' if bad else 'ok', summary or f'check_docs exit {r.returncode}')
    else:
        put('decay', 'ask', 'no check_docs.py: dead links, paths and commands are not checked')

    # work-units
    core = (project / '.claude' / 'org-rules' / ('00-core-agents.md' if lang == 'en' else '00-rdzen-praca-agentow.md')).exists()
    if core and commands:
        put('work-units', 'ok', 'core rules (commits, parallel agents, reports) plus the verification commands define "done"')
    elif core:
        put('work-units', 'partial', 'core rules cover commits and parallel agents; without verification commands "done" is undefined')
    else:
        put('work-units', 'ask', 'no rules on what one change is, when it is done, or how parallel agents stay apart')

    # Answers and exclusions the Owner gave earlier (tools/docs/standard.json, "audit").
    today = time.time()
    for key, rec in recorded(project).items():
        if key not in out or not isinstance(rec, dict):
            continue
        age = (today - time.mktime(time.strptime(rec.get('date', '1970-01-01'), '%Y-%m-%d'))) / 86400
        if rec.get('status') == 'n/a':
            out[key] = {'status': 'na', 'evidence': f'not applicable: {rec.get("note", "")}'}
        elif rec.get('status') == 'answered' and out[key]['status'] in ('ask', 'partial') and age <= ANSWER_DAYS:
            out[key] = {'status': 'ok', 'evidence': f'answered {rec["date"]}: {rec.get("note", "")}'}
        elif rec.get('status') == 'answered' and age > ANSWER_DAYS:
            out[key]['evidence'] += f' (last answered {rec["date"]}, over {ANSWER_DAYS} days ago: ask again)'
    return {'language': lang, 'entry': entry_rel, 'items': out}


def cmd_audit(project: Path, as_json: bool, record: list[str]) -> int:
    if record:
        if len(record) < 2 or record[0] not in dict(AUDIT_ITEMS) or record[1] not in ('answered', 'n/a', 'clear'):
            print('  ✗ --record <item> answered|n/a|clear "<note>"; items: ' + ', '.join(k for k, _ in AUDIT_ITEMS))
            return 2
        path = project / 'tools' / 'docs' / 'standard.json'
        try:
            data = json.loads(path.read_text()) if path.exists() else {}
        except ValueError:
            print(f'  ✗ {path}: invalid JSON')
            return 2
        data.setdefault('audit', {})
        if record[1] == 'clear':
            data['audit'].pop(record[0], None)
        else:
            data['audit'][record[0]] = {'status': record[1], 'date': time.strftime('%Y-%m-%d'),
                                        'note': ' '.join(record[2:])}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        print(f'  ✓ {record[0]}: {record[1]} recorded in tools/docs/standard.json')
        return 0
    result = audit(project)
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    items = result['items']
    for key, question in AUDIT_ITEMS:
        it = items[key]
        print(f'  {MARKS[it["status"]]} {key:<10} {question}\n      {it["evidence"]}')
    done = sum(1 for it in items.values() if it['status'] in ('ok', 'na'))
    print(f'  harness audit: {done}/{len(items)} covered')
    return 0


VALUE_OPTIONS = ('project', 'owner', 'github', 'description', 'lang')


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    cmd, project = argv[1], Path(argv[2]).expanduser().resolve()
    rest = argv[3:]
    opts, free, i = {}, [], 0
    while i < len(rest):
        a = rest[i]
        if a.startswith('--'):
            name = a[2:]
            if name in VALUE_OPTIONS and i + 1 < len(rest):
                opts[name] = rest[i + 1]
                i += 1
            else:
                opts[name] = True
        else:
            free.append(a)
        i += 1
    if not project.is_dir():
        print(f'  ✗ no directory {project}')
        return 2
    if cmd == 'state':
        return cmd_state(project, 'json' in opts, opts.get('lang'))
    if cmd == 'init':
        return cmd_init(project, opts)
    if cmd == 'core':
        return cmd_core(project, 'write' in opts)
    if cmd == 'rename-entry':
        return cmd_rename_entry(project)
    if cmd == 'archive':
        return cmd_archive(project, free)
    if cmd == 'audit':
        record = free if 'record' in opts else []
        return cmd_audit(project, 'json' in opts, record)
    if cmd == 'hook':
        print('  + hook added' if merge_hook(project, repo_language(project, opts.get('lang'))) else '  ✓ hook already there')
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
