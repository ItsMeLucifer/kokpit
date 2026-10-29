#!/usr/bin/env python3
# core: 0.10.0 (Kokpit repo standard; updated by /kokpit:setup, do not edit by hand)
"""Consistency of project knowledge and agent rules (standard library only, about 1 s).

    python3 tools/docs/check_docs.py                  # check everything, exit 1 on errors
    python3 tools/docs/check_docs.py --quiet          # errors only
    python3 tools/docs/check_docs.py --hook           # PostToolUse hook: reads the event from stdin, checks only after a
                                                      # change in .claude/ or docs/, errors on stderr with exit 2 (back to the agent)
    python3 tools/docs/check_docs.py --hints          # rebuild the directory hints from the rules' `paths:`
    python3 tools/docs/check_docs.py --write-manifest # after an org-rules change on the Owner's instruction

Checks (rules: the core knowledge file in .claude/org-rules/; parameters: tools/docs/standard.json):
  1. org-rules: MANIFEST.sha256, headers (`status`, `version`, `core` in core files), the project file 10-project.md;
  2. entry .claude/CLAUDE.md: lowercase name, org-rules imports, size, AGENTS.md as a link;
  3. startup budget: entry + imports + descriptions of project skills (a warning above `budget_tokens`);
  4. unfilled `{{...}}` templates in org-rules and the entry; a project file without verification commands;
  5. rules in .claude/rules/: `paths:` globs that match no file;
  6. directory hints (<directory>/CLAUDE.md marked "generated") consistent with `paths:`;
  7. dead markdown links and `docs/…`, `.claude/…` paths in backticks;
  8. agent memory (this machine's MEMORY.md): dead links, entries granting permissions org-rules forbid (warnings);
  9. project checks: tools/docs/check_docs_project.py with sprawdz/check(root, files) -> (errors, warnings).

Repos that follow the Polish variant of the standard (00-rdzen-*, 10-projekt.md, `rdzen:`, `wersja:`,
```kokpit-nietykalne```) are checked the same way.
"""
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ORG = os.path.join(ROOT, ".claude", "org-rules")
MANIFEST = os.path.join(ORG, "MANIFEST.sha256")
ENTRY = ".claude/CLAUDE.md"
CONFIG = os.path.join(ROOT, "tools", "docs", "standard.json")
PROJECT_CHECKS = [os.path.join(ROOT, "tools", "docs", n) for n in ("check_docs_project.py", "check_docs_projekt.py")]
PROJECT_FILES = ("10-project.md", "10-projekt.md")
CORE_PREFIXES = ("00-core-", "00-rdzen-")
MARKER = "<!-- generated: python3 tools/docs/check_docs.py --hints; do not edit by hand -->"
OLD_MARKERS = (MARKER, "<!-- generowane: python3 tools/docs/check_docs.py --hints")
DEFAULTS = {
    "budget_tokens": 6000,
    "bytes_per_token": 3,
    "entry_limit": 30000,
    "link_scope": ["docs/", ".claude/", "AGENTS.md"],
    "link_skip": ["docs/archive/", "docs/archiwum/", ".claude/handoffs/"],
    "local": [],
}
# standard.json keys of the Polish variant.
LEGACY_CONFIG = {
    "budzet_tokenow": "budget_tokens",
    "bajty_na_token": "bytes_per_token",
    "limit_claude_md": "entry_limit",
    "linki_zakres": "link_scope",
    "linki_pomijaj": "link_skip",
    "lokalne": "local",
}
PROTECTED_KINDS = {"data": "data", "dane": "data", "manual": "manual", "reczne": "manual",
                   "generator": "generator", "paid": "paid", "platne": "paid"}

errors, warnings = [], []  # errors: (kind, text)


def error(text, kind="general"):
    errors.append((kind, text))


def config():
    c = dict(DEFAULTS)
    if os.path.exists(CONFIG):
        try:
            for key, value in json.load(open(CONFIG, encoding="utf-8")).items():
                if not key.startswith("_"):
                    c[LEGACY_CONFIG.get(key, key)] = value
        except ValueError as e:
            error(f"tools/docs/standard.json: invalid JSON ({e})")
    return c


def read(rel):
    try:
        return open(os.path.join(ROOT, rel), encoding="utf-8", errors="ignore").read()
    except OSError:
        return ""


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def frontmatter(text):
    if not text.startswith("---"):
        return ""
    end = text.find("\n---", 3)
    return text[3:end] if end > 0 else ""


def field(fm, *names):
    for name in names:
        m = re.search(rf"^{name}:\s*(.*)$", fm, re.M)
        if m:
            return m.group(1).strip().strip("\"'")
    return None


def repo_files():
    try:
        out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout.splitlines()
        return sorted(f for f in out if os.path.lexists(os.path.join(ROOT, f)))
    except (OSError, subprocess.CalledProcessError):
        found = []
        for d, dirs, names in os.walk(ROOT):
            dirs[:] = [x for x in dirs if x not in (".git", "node_modules", ".venv")]
            found += [os.path.relpath(os.path.join(d, n), ROOT) for n in names]
        return sorted(found)


def project_file():
    for name in PROJECT_FILES:
        if os.path.exists(os.path.join(ORG, name)):
            return f".claude/org-rules/{name}"
    return None


# --- protected items from the project file ----------------------------------------------------------

def protected():
    rel = project_file()
    m = re.search(r"```kokpit-(?:protected|nietykalne)\n(.*?)```", read(rel) if rel else "", re.S)
    items = []
    for line in (m.group(1) if m else "").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or "{{" in line:
            continue
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0] in PROTECTED_KINDS:
            items.append((PROTECTED_KINDS[parts[0]], parts[1].strip()))
    return items


# --- 1. org-rules ------------------------------------------------------------------------------------

def org_files():
    return sorted(f for f in os.listdir(ORG) if f != "MANIFEST.sha256" and not f.startswith("."))


def write_manifest():
    lines = [f"{sha(os.path.join(ORG, f))}  {f}" for f in org_files()]
    with open(MANIFEST, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {os.path.relpath(MANIFEST, ROOT)} ({len(lines)} files)")


def check_org():
    if not os.path.isdir(ORG):
        error(".claude/org-rules/ does not exist")
        return
    if not os.path.exists(MANIFEST):
        error(".claude/org-rules/MANIFEST.sha256 does not exist (python3 tools/docs/check_docs.py --write-manifest)")
    else:
        expected = {}
        for line in open(MANIFEST, encoding="utf-8"):
            if line.strip():
                digest, name = line.split(None, 1)
                expected[name.strip()] = digest
        actual = {f: sha(os.path.join(ORG, f)) for f in org_files()}
        for name, digest in expected.items():
            if name not in actual:
                error(f"org-rules: {name} is missing (it is in the manifest)")
            elif actual[name] != digest:
                error(f"org-rules: {name} changed since the manifest (only the Owner changes these rules)")
        for name in actual:
            if name not in expected:
                error(f"org-rules: {name} is not in the manifest")
    if not project_file():
        error("org-rules: no 10-project.md (Owner, project rules, protected items)")
    for f in org_files():
        if not f.endswith(".md"):
            continue
        fm = frontmatter(read(f".claude/org-rules/{f}"))
        if field(fm, "status") != "org-rules" or not field(fm, "version", "wersja"):
            error(f"org-rules/{f}: header without `status: org-rules` or `version`")
        if (f == "README.md" or f.startswith(CORE_PREFIXES)) and not field(fm, "core", "rdzen"):
            error(f"org-rules/{f}: core file without `core:` (version from Kokpit)")


# --- 2–4. entry, budget, templates -------------------------------------------------------------------

IMPORT = re.compile(r"(?:^|\s)@([~\w./\-]+\.md)\b")


def without_code(text):
    return re.sub(r"```.*?```", "", text, flags=re.S)


def imports(rel, depth=0, seen=None):
    """Files loaded at startup together with `rel` (@ directives, up to 5 levels)."""
    seen = seen if seen is not None else []
    if rel in seen or depth > 5 or not os.path.exists(os.path.join(ROOT, rel)):
        return seen
    seen.append(rel)
    for m in IMPORT.finditer(re.sub(r"`[^`\n]*`", "", without_code(read(rel)))):
        target = m.group(1)
        if target.startswith("~"):
            continue
        imports(os.path.normpath(os.path.join(os.path.dirname(rel), target)), depth + 1, seen)
    return seen


def skill_descriptions():
    directory = os.path.join(ROOT, ".claude", "skills")
    total = 0
    for name in sorted(os.listdir(directory)) if os.path.isdir(directory) else []:
        fm = frontmatter(read(f".claude/skills/{name}/SKILL.md"))
        if fm and field(fm, "disable-model-invocation") != "true":
            total += len((field(fm, "description") or "").encode()) + len(name) + 4
    return total


def check_entry(c):
    directory = os.path.join(ROOT, ".claude")
    names = os.listdir(directory) if os.path.isdir(directory) else []
    wrong = [n for n in names if n.lower() == "claude.md" and n != "CLAUDE.md"]
    for n in wrong:
        error(f".claude/{n}: the name must be `CLAUDE.md` (another case may not load)")
    if "CLAUDE.md" not in names:
        if not wrong:
            error(f"no {ENTRY}")
        return
    size = len(read(ENTRY).encode())
    if size > c["entry_limit"]:
        error(f"{ENTRY} is {size} B (limit {c['entry_limit']} B; move details to rules and the wiki)")
    loaded = imports(ENTRY)
    project = project_file() or ".claude/org-rules/10-project.md"
    for target in (".claude/org-rules/README.md", project):
        if target not in loaded:
            error(f"{ENTRY}: missing import @{os.path.relpath(target, '.claude')}")
    agents = os.path.join(ROOT, "AGENTS.md")
    if not os.path.islink(agents) or os.path.realpath(agents) != os.path.realpath(os.path.join(ROOT, ENTRY)):
        error("AGENTS.md in the root must be a link to .claude/CLAUDE.md (ln -sf .claude/CLAUDE.md AGENTS.md)")
    size = sum(len(read(r).encode()) for r in loaded)
    skills = skill_descriptions()
    tokens = (size + skills) // c["bytes_per_token"]
    if tokens > c["budget_tokens"]:
        warnings.append(f"startup budget: about {tokens} tokens (entry with imports {size} B, skill descriptions "
                        f"{skills} B), budget {c['budget_tokens']}")
    org = [f".claude/org-rules/{f}" for f in (org_files() if os.path.isdir(ORG) else [])]
    for rel in dict.fromkeys(loaded + org):
        for number, line in enumerate(read(rel).splitlines(), 1):
            if re.search(r"\{\{[A-Z_]+\}\}", line):
                error(f"{rel}:{number}: unfilled template ({line.strip()[:60]})", "template")
                break
    m = re.search(r"^## (?:Verification|Weryfikacja)[^\n]*\n(.*?)(?=^## |\Z)", read(project), re.M | re.S)
    commands = re.findall(r"```(?:bash|sh)?\n(.*?)```", m.group(1), re.S) if m else []
    if not any(line.strip() and not line.strip().startswith("#") and "{{" not in line
               for block in commands for line in block.splitlines()):
        warnings.append(f"{project}: no verification commands (section \"Verification\"); the agent cannot check its work")


# --- 5–6. rules and directory hints ------------------------------------------------------------------

def glob_re(glob):
    i, out = 0, ""
    while i < len(glob):
        ch = glob[i]
        if glob.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
            continue
        if glob.startswith("**", i):
            out += ".*"
            i += 2
            continue
        if ch == "*":
            out += "[^/]*"
        elif ch == "?":
            out += "[^/]"
        elif ch == "{":
            end = glob.find("}", i)
            if end < 0:
                out += re.escape(ch)
            else:
                out += "(?:" + "|".join(re.escape(x) for x in glob[i + 1:end].split(",")) + ")"
                i = end
        else:
            out += re.escape(ch)
        i += 1
    return re.compile(out + "(?:/.*)?$" if glob.endswith("/") else out + "$")


def rules():
    """[(rule path, [globs])] for .claude/rules/**/*.md."""
    found = []
    directory = os.path.join(ROOT, ".claude", "rules")
    for d, _, names in os.walk(directory):
        for n in sorted(names):
            if not n.endswith(".md"):
                continue
            rel = os.path.relpath(os.path.join(d, n), ROOT)
            fm = frontmatter(read(rel))
            m = re.search(r"^paths:[ \t]*(.*?)(?=^[A-Za-z_][\w-]*:|\Z)", fm + "\n", re.M | re.S)
            if not m:
                continue
            raw = m.group(1).strip()
            if raw.startswith("["):
                globs = [g.strip().strip("\"'") for g in raw.strip("[]").split(",")]
            elif raw and not raw.startswith("-"):
                globs = [g.strip().strip("\"'") for g in raw.split(",")]
            else:
                globs = [re.sub(r"^-\s*", "", g.strip()).strip("\"'") for g in raw.splitlines() if g.strip().startswith("-")]
            found.append((rel, [g for g in globs if g]))
    return sorted(found)


def check_rules(files):
    for rel, globs in rules():
        for g in globs:
            pattern = glob_re(g)
            if not any(pattern.match(p) for p in files):
                error(f"{rel}: the `paths:` glob `{g}` matches no file")


def glob_directory(glob):
    parts = glob.split("/")
    fixed = []
    for part in parts:
        if re.search(r"[*?{\[]", part):
            break
        fixed.append(part)
    else:  # a glob without wildcards: a file or a directory
        path = "/".join(fixed)
        return path if os.path.isdir(os.path.join(ROOT, path)) else os.path.dirname(path)
    return "/".join(fixed)


def expected_hints():
    by_dir = {}
    for rel, globs in rules():
        for g in globs:
            d = glob_directory(g).strip("/")
            if d and not d.startswith(".") and os.path.isdir(os.path.join(ROOT, d)):
                by_dir.setdefault(d, set()).add(rel)
    out = {}
    for d, rs in sorted(by_dir.items()):
        listed = "\n".join(f"- `{r}`" for r in sorted(rs))
        out[f"{d}/CLAUDE.md"] = f"{MARKER}\nBefore changing files in this directory, read the area rule:\n{listed}\n"
    return out


def generated(text):
    return any(m in text for m in OLD_MARKERS)


def present_hints(files):
    return {p for p in files if os.path.basename(p) == "CLAUDE.md" and p != ENTRY and generated(read(p))}


def check_hints(files, write=False):
    expected, present = expected_hints(), present_hints(files)
    changes = []
    for rel, content in expected.items():
        path = os.path.join(ROOT, rel)
        if os.path.exists(path) and not generated(read(rel)):
            warnings.append(f"{rel}: a hand-written directory hint; add a pointer to the area rules yourself")
            continue
        if read(rel) != content:
            changes.append(rel)
            if write:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
        agents = os.path.join(os.path.dirname(path), "AGENTS.md")
        if not os.path.lexists(agents):
            changes.append(os.path.relpath(agents, ROOT))
            if write:
                os.symlink("CLAUDE.md", agents)
    for rel in sorted(present - set(expected)):
        changes.append(f"{rel} (no longer needed)")
        if write:
            os.remove(os.path.join(ROOT, rel))
            agents = os.path.join(ROOT, os.path.dirname(rel), "AGENTS.md")
            if os.path.islink(agents) and os.readlink(agents) == "CLAUDE.md":
                os.remove(agents)
    if write:
        for change in changes:
            print(f"  hint: {change}")
        print(f"Directory hints: {len(changes)} changes")
    else:
        for change in changes:
            error(f"directory hint out of date: {change} (python3 tools/docs/check_docs.py --hints)")


# --- 7. links ----------------------------------------------------------------------------------------

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
TICK = re.compile(r"`([^`\n]+)`")
PATH = re.compile(r"^(?:docs|\.claude)/[\w./\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+$")
PLACEHOLDER = re.compile(r"NNN|\.\.\.|…|\*|<|>|\{|\}|XX|\$")


def exists(rel, local):
    rel = rel.rstrip("/")
    return rel.startswith(local) or os.path.lexists(os.path.join(ROOT, rel))


def check_links(files, c, local):
    scope, skip = tuple(c["link_scope"]), tuple(c["link_skip"])
    for rel in files:
        if not rel.endswith(".md") or not (rel.startswith(scope) or rel in scope) or rel.startswith(skip):
            continue
        base, in_code = os.path.dirname(rel), False
        for number, line in enumerate(read(rel).splitlines(), 1):
            if line.strip().startswith("```"):
                in_code = not in_code
                continue
            if in_code:
                continue
            for m in LINK.finditer(re.sub(r"`[^`\n]*`", "", line)):
                target = m.group(1).split("#")[0]
                if not target or re.match(r"^[a-z]+:", target):
                    continue
                if not exists(os.path.normpath(os.path.join(base, target)), local):
                    error(f"{rel}:{number}: dead link → {target}")
            for m in TICK.finditer(line):
                token = re.sub(r":\d+(?:-\d+)?$", "", m.group(1).strip().rstrip(".,;:)").split("#")[0])
                if PATH.match(token) and not token.endswith("/") and not PLACEHOLDER.search(token) and not exists(token, local):
                    error(f"{rel}:{number}: path does not exist `{token}`")


# --- 8. agent memory ---------------------------------------------------------------------------------

GRANTS = re.compile(r"without asking|without (?:the user's )?consent|--no-verify|always allowed|do not ask|"
                    r"bez pytania|bez zgody|zawsze wolno|nie pytaj o", re.I)


def memory_dir():
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=ROOT,
                                capture_output=True, text=True, check=True).stdout.strip()
        main = os.path.dirname(common) if common.endswith("/.git") else ROOT
    except (OSError, subprocess.CalledProcessError):
        main = ROOT
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude"))
    return os.path.join(config_dir, "projects", re.sub(r"[^A-Za-z0-9]", "-", main), "memory")


def check_memory():
    if os.environ.get("CI"):
        return
    directory = memory_dir()
    index = os.path.join(directory, "MEMORY.md")
    if not os.path.exists(index):
        return
    for number, line in enumerate(open(index, encoding="utf-8", errors="ignore").read().splitlines(), 1):
        for m in LINK.finditer(line):
            target = m.group(1).split("#")[0]
            if target and not re.match(r"^[a-z]+:", target) and not os.path.exists(os.path.join(directory, target)):
                warnings.append(f"memory MEMORY.md:{number}: dead link → {target}")
        if GRANTS.search(line):
            warnings.append(f"memory MEMORY.md:{number}: an entry grants a permission org-rules may forbid "
                            f"(memory grants no permissions): {line.strip()[:80]}")


# --- 9. project checks -------------------------------------------------------------------------------

def check_project(files):
    path = next((p for p in PROJECT_CHECKS if os.path.exists(p)), None)
    if not path:
        return
    spec = importlib.util.spec_from_file_location("check_docs_project", path)
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        run = getattr(module, "check", None) or getattr(module, "sprawdz")
        found_errors, found_warnings = run(ROOT, files)
    except Exception as e:  # noqa: BLE001 — a failure in project checks must not stop the core
        error(f"{os.path.relpath(path, ROOT)}: {type(e).__name__}: {e}")
        return
    for x in found_errors:
        error(x)
    warnings.extend(found_warnings)


# --- entry point -------------------------------------------------------------------------------------

def concerns(event):
    tool_input = event.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not path:
        return False
    rel = os.path.relpath(os.path.abspath(path), ROOT)
    return rel.startswith((".claude/", "docs/")) or os.path.basename(rel) in ("CLAUDE.md", "AGENTS.md")


def main():
    args = sys.argv[1:]
    if "--write-manifest" in args:
        write_manifest()
        return 0
    hook = "--hook" in args
    if hook:
        try:
            if not concerns(json.load(sys.stdin)):
                return 0
        except ValueError:
            return 0
    c = config()
    local = tuple(x.rstrip("/") for x in c["local"]) + tuple(p.rstrip("/") for kind, p in protected() if kind == "data")
    files = repo_files()
    if "--hints" in args:
        check_hints(files, write=True)
        return 0
    check_org()
    check_entry(c)
    check_rules(files)
    check_hints(files)
    check_links(files, c, local)
    if not hook:
        check_memory()
    check_project(files)
    if hook:
        important = [t for kind, t in errors if kind != "template"]
        if important:
            print("check_docs after this change:\n" + "\n".join(f"ERROR: {t}" for t in important), file=sys.stderr)
            return 2
        return 0
    if "--quiet" not in args:
        for w in warnings:
            print("WARNING:", w)
    for _, t in errors:
        print("ERROR:", t)
    if "--quiet" not in args:
        print(f"check_docs: {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
