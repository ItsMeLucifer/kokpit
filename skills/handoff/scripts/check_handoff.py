#!/usr/bin/env python3
"""Checks a handoff thread file.

    check_handoff.py <file.md> [--previous <previous-version.md>]

Exit 1 = an error to fix: a missing section, a leftover placeholder, a possible secret, or a point of a
protected section that was in the previous version and disappeared. Exit 0 = fine (notes are only printed).

Next to <thread>.md there may be <thread>.archive.md (or <thread>.archiwum.md for Polish threads): the archive
and older log entries, append only. A point moved there counts as kept; a point that was in the previous
version of the archive (the copy in .previous/) must not disappear from it.

Threads are written in English or Polish; the language is detected from the headings.
"""
import re
import sys
from pathlib import Path

# Section keys and their headings per language.
HEADINGS = {
    "en": {
        "goal": "## Goal",
        "state": "## Current state",
        "decisions": "## Decisions",
        "dropped": "## Tried and dropped",
        "notes": "## User notes and pitfalls",
        "questions": "## Open questions",
        "next": "## Next steps",
        "quick": "## Quick start",
        "log": "## Log",
        "archive": "## Archive",
    },
    "pl": {
        "goal": "## Cel",
        "state": "## Stan teraz",
        "decisions": "## Decyzje",
        "dropped": "## Próbowaliśmy i odpadło",
        "notes": "## Uwagi użytkownika i pułapki",
        "questions": "## Otwarte pytania",
        "next": "## Następne kroki",
        "quick": "## Szybki start",
        "log": "## Dziennik",
        "archive": "## Archiwum",
    },
}
REQUIRED = ["goal", "state", "decisions", "dropped", "notes", "questions", "next", "quick", "log"]
# Sections that are appended to, not summarized: every point of the previous version must stay in the file
# (in its section, or in the archive with a note on what superseded it).
PROTECTED = ["decisions", "dropped", "notes"]
FRONTMATTER = ["thread:", "sessions:", "updated:"]
EMPTY = ("none", "none.", "brak", "brak.", "—")

SECRETS = [
    (r"sk-ant-[A-Za-z0-9_\-]{10,}", "Anthropic key"),
    (r"sk-[A-Za-z0-9]{20,}", "API key"),
    (r"gh[pousr]_[A-Za-z0-9]{20,}", "GitHub token"),
    (r"AKIA[0-9A-Z]{16}", "AWS key"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key"),
    (r"(?i)(password|hasło|haslo|secret|token)\s*[:=]\s*\S{6,}", "password/token in the text"),
    (r"eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.", "JWT"),
]

PLACEHOLDERS = [
    r"\[TODO",
    r"\bTBD\b",
    r"<fill in",
    r"<uzupełnij",
    r"<\.\.\.>",
    r"^\s*(?:[-*]|\d+[.)])?\s*(?:[\w ]+:\s*)?<[^>\n]{3,}>",
]

# This many latest log entries stay in the thread file; older ones go word for word to the archive.
LOG_KEEP = 8
# Above this size the thread file (read in full at /resume and at every handoff) should be slimmed.
SIZE_WARN = 20_000
ARCHIVE_SUFFIXES = (".archive.md", ".archiwum.md")


def language(text: str) -> str:
    return "pl" if re.search(r"^## (Cel|Stan teraz|Dziennik)\b", text, re.M) else "en"


def section(text: str, heading: str) -> str:
    m = re.search(re.escape(heading) + r"[^\n]*\n(.*?)(?=\n## |\Z)", text, re.S)
    return m.group(1).strip() if m else ""


def bullets(body: str) -> list:
    out = []
    for line in body.splitlines():
        m = re.match(r"^\s*[-*]\s+(.*\S)", line)
        if m and m.group(1).lower() not in EMPTY:
            out.append(m.group(1))
    return out


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def archive_of(path: Path, lang: str) -> Path:
    """<thread>.md → the existing archive next to it, or the one the thread's language would create."""
    stem = path.name[: -len(".md")]
    for suffix in ARCHIVE_SUFFIXES:
        candidate = path.with_name(stem + suffix)
        if candidate.is_file():
            return candidate
    return path.with_name(stem + (".archiwum.md" if lang == "pl" else ".archive.md"))


def main(argv: list) -> int:
    args = [a for a in argv if a != "--previous"]
    prev_path = None
    if "--previous" in argv:
        i = argv.index("--previous")
        if i + 1 < len(argv):
            prev_path = Path(argv[i + 1])
            args = [a for a in args if a != argv[i + 1]]
    if len(args) != 1:
        print(__doc__)
        return 1
    path = Path(args[0])
    if not path.is_file():
        print(f"ERROR: no file {path}")
        return 1
    if path.name.endswith(ARCHIVE_SUFFIXES):
        print(f"ERROR: {path.name} is a thread archive; check the thread file itself")
        return 1
    text = path.read_text(encoding="utf-8")
    lang = language(text)
    h = HEADINGS[lang]
    archive = archive_of(path, lang)
    archive_text = archive.read_text(encoding="utf-8") if archive.is_file() else ""
    errors, notes = [], []

    head = text.split("\n---", 2)[0] if text.startswith("---") else ""
    if not head:
        errors.append("no frontmatter (thread, sessions, updated)")
    for key in FRONTMATTER:
        if head and not re.search("^" + re.escape(key), head, re.M):
            errors.append(f"frontmatter without the \"{key}\" field")

    for key in REQUIRED:
        heading = h[key]
        if heading not in text:
            errors.append(f"missing section \"{heading}\"")
        elif not section(text, heading):
            errors.append(f"empty section \"{heading}\" (write \"none\" if there really is nothing)")
    for pat in PLACEHOLDERS:
        for line in text.splitlines():
            if re.search(pat, line):
                errors.append(f"leftover placeholder: {line.strip()[:80]}")
                break
    for pat, name in SECRETS:
        if re.search(pat, text) or re.search(pat, archive_text):
            errors.append(f"possible secret ({name}): mask it")

    if prev_path and prev_path.is_file():
        prev = prev_path.read_text(encoding="utf-8")
        hp = HEADINGS[language(prev)]
        whole = norm(text + "\n" + archive_text)
        for key in PROTECTED:
            for b in bullets(section(prev, hp[key])):
                if norm(b) not in whole:
                    errors.append(
                        f"a point disappeared from \"{hp[key]}\": \"{b[:90]}\" — restore it or move it to "
                        f"\"{h['archive']}\" in {archive.name} with a reason"
                    )
        old_log = bullets(section(prev, hp["log"]))
        new_log = norm(section(text, h["log"]) + " " + section(text, h["archive"]) + " " + archive_text)
        lost = [d for d in old_log if norm(d) not in new_log]
        if lost:
            errors.append(f"{len(lost)} entries disappeared from \"{h['log']}\": move them word for word to {archive.name}")
        # The archive only grows: everything that was in it before must stay in it.
        prev_archive = archive_of(prev_path, language(prev))
        if prev_archive.is_file():
            current = norm(archive_text)
            for b in bullets(prev_archive.read_text(encoding="utf-8")):
                if norm(b) not in current:
                    errors.append(f"a point disappeared from {archive.name}: \"{b[:90]}\" — the archive is append only")

    steps = section(text, h["next"])
    if steps and not re.search(r"^\s*1[.)]", steps, re.M):
        notes.append(f"\"{h['next']}\" without numbering: step 1 must be the first action")
    state = text.split(h["log"])[0]
    for key in PROTECTED:
        state = state.replace(section(text, h[key]), "")
    words = len(state.split())
    if words > 1000:
        notes.append(f"the summarized sections have {words} words: shorten them (link instead of copying)")
    log = bullets(section(text, h["log"]))
    if len(log) > LOG_KEEP:
        notes.append(
            f"\"{h['log']}\" has {len(log)} entries: move the ones older than the last {LOG_KEEP} word for word "
            f"to the older-log section of {archive.name}"
        )
    archived_here = [b for b in bullets(section(text, h["archive"])) if not any(s in b for s in ARCHIVE_SUFFIXES)]
    if archived_here:
        notes.append(f"\"{h['archive']}\" has {len(archived_here)} points in the thread file: move them word for word to {archive.name}")
    size = len(text.encode("utf-8"))
    if size > SIZE_WARN:
        if archived_here or len(log) > LOG_KEEP:
            hint = f"move the archive and older log entries to {archive.name}"
        else:
            hint = (
                "shorten the summarized sections (link instead of copying), move protected points that no longer "
                f"apply to {archive.name}, and lasting findings to the project's documents (leave a reference in the thread)"
            )
        notes.append(f"the thread file is {size // 1024} KB (read in full at /resume): {hint}")

    for n in notes:
        print("NOTE:", n)
    for e in errors:
        print("ERROR:", e)
    if errors:
        return 1
    print(f"OK: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
