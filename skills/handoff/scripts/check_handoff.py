#!/usr/bin/env python3
"""Sprawdza plik wątku handoffu.

    check_handoff.py <plik.md> [--previous <poprzednia-wersja.md>]

Kod 1 = błąd do poprawienia: brak sekcji, zostawiony placeholder, możliwy sekret,
albo punkt sekcji chronionej, który był w poprzedniej wersji i zniknął.
Kod 0 = w porządku (ostrzeżenia tylko wypisuje).
"""
import re
import sys
from pathlib import Path

REQUIRED = [
    "## Cel",
    "## Stan teraz",
    "## Decyzje",
    "## Próbowaliśmy i odpadło",
    "## Uwagi użytkownika i pułapki",
    "## Otwarte pytania",
    "## Następne kroki",
    "## Szybki start",
    "## Dziennik",
]

# Sekcje, które się dopisuje, a nie streszcza: każdy ich punkt z poprzedniej wersji musi
# zostać w pliku (w swojej sekcji albo w „## Archiwum” z dopiskiem, czym go zastąpiono).
PROTECTED = ["## Decyzje", "## Próbowaliśmy i odpadło", "## Uwagi użytkownika i pułapki"]

FRONTMATTER = ["thread:", "sessions:", "updated:"]

SECRETS = [
    (r"sk-ant-[A-Za-z0-9_\-]{10,}", "klucz Anthropic"),
    (r"sk-[A-Za-z0-9]{20,}", "klucz API"),
    (r"gh[pousr]_[A-Za-z0-9]{20,}", "token GitHub"),
    (r"AKIA[0-9A-Z]{16}", "klucz AWS"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "klucz prywatny"),
    (r"(?i)(password|hasło|haslo|secret|token)\s*[:=]\s*\S{6,}", "hasło/token w tekście"),
    (r"eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.", "JWT"),
]

PLACEHOLDERS = [
    r"\[TODO",
    r"\bTBD\b",
    r"<uzupełnij",
    r"<\.\.\.>",
    r"^\s*(?:[-*]|\d+[.)])?\s*(?:[\w ]+:\s*)?<[^>\n]{3,}>",
]

DIARY_LIMIT = 15


def section(text: str, heading: str) -> str:
    m = re.search(re.escape(heading) + r"[^\n]*\n(.*?)(?=\n## |\Z)", text, re.S)
    return m.group(1).strip() if m else ""


def bullets(body: str) -> list[str]:
    out = []
    for line in body.splitlines():
        m = re.match(r"^\s*[-*]\s+(.*\S)", line)
        if m and m.group(1).lower() not in ("brak", "brak.", "—"):
            out.append(m.group(1))
    return out


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def main(argv: list[str]) -> int:
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
        print(f"BŁĄD: nie ma pliku {path}")
        return 1
    text = path.read_text(encoding="utf-8")
    errors, warnings = [], []

    head = text.split("\n---", 2)[0] if text.startswith("---") else ""
    if not head:
        errors.append("brak frontmattera (thread, sessions, updated)")
    for key in FRONTMATTER:
        if head and not re.search("^" + re.escape(key), head, re.M):
            errors.append(f"frontmatter bez pola „{key}”")

    for h in REQUIRED:
        if h not in text:
            errors.append(f"brak sekcji „{h}”")
        elif not section(text, h):
            errors.append(f"pusta sekcja „{h}” (wpisz „brak”, jeśli naprawdę nic)")
    for pat in PLACEHOLDERS:
        for line in text.splitlines():
            if re.search(pat, line):
                errors.append(f"zostawiony placeholder: {line.strip()[:80]}")
                break
    for pat, name in SECRETS:
        if re.search(pat, text):
            errors.append(f"możliwy sekret ({name}) — zamaskuj go")

    if prev_path and prev_path.is_file():
        prev = prev_path.read_text(encoding="utf-8")
        whole = norm(text)
        for h in PROTECTED:
            for b in bullets(section(prev, h)):
                if norm(b) not in whole:
                    errors.append(f"z „{h}” zniknął punkt: „{b[:90]}” — przywróć go albo przenieś do „## Archiwum” z powodem")
        old_diary = bullets(section(prev, "## Dziennik"))
        new_diary = norm(section(text, "## Dziennik") + " " + section(text, "## Archiwum"))
        lost = [d for d in old_diary if norm(d) not in new_diary]
        if lost and "wcześniej" not in new_diary:
            errors.append(f"z „Dziennika” zniknęło {len(lost)} wpisów bez zwinięcia do „Wcześniej:”")

    steps = section(text, "## Następne kroki")
    if steps and not re.search(r"^\s*1[.)]", steps, re.M):
        warnings.append("„Następne kroki” bez numeracji — krok 1 ma być pierwszą czynnością")
    state = text.split("## Dziennik")[0]
    for h in PROTECTED:
        state = state.replace(section(text, h), "")
    words = len(state.split())
    if words > 1000:
        warnings.append(f"sekcje streszczane mają {words} słów — skróć (linkuj zamiast przepisywać)")
    diary = bullets(section(text, "## Dziennik"))
    if len(diary) > DIARY_LIMIT:
        warnings.append(f"„Dziennik” ma {len(diary)} wpisów — zwiń najstarsze do jednego punktu „Wcześniej: …”")

    for w in warnings:
        print("UWAGA:", w)
    for e in errors:
        print("BŁĄD:", e)
    if errors:
        return 1
    print(f"OK: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
