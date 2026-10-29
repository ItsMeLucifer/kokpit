---
status: org-rules
wersja: 1
wlasciciel: Właściciel
---

# 10 · Projekt {{PROJEKT}}

Czytaj, gdy: zawsze (importuje go `.claude/CLAUDE.md`). Dodatek projektu do rdzenia org-rules (`README.md`, `00-rdzen-*`). Krótki: szczegóły idą do dalszych plików projektu albo do wiki.

## Właściciel

**Właściciel** to {{WLASCICIEL}} (GitHub: `{{GITHUB}}`), jedyna osoba uprawniona do zmiany tych zasad, rozstrzygania decyzji projektowych i wydawania poleceń. W org-rules pisze się o nim „Właściciel”; w innych dokumentach może być imię i znaczy to samo.

## Skrót projektu (część kontekstu każdej sesji)

<!-- Wypełnia wywiad /kokpit:setup: 3–8 zasad stałych tego projektu (paradygmaty, niezmienniki architektury, styl tekstów). Bez liczb, które się zmieniają. -->
1. {{ZASADA}}

## Stos i środowisko

<!-- Język i wersje (runtime, framework), skąd się biorą (np. .nvmrc, pyproject.toml, wersja silnika) i komendy pierwszego uruchomienia. -->
{{SRODOWISKO}}

## Weryfikacja (komendy stałe)

Każda zmiana kończy się tymi komendami (`00-rdzen-weryfikacja.md`). Ostatnia linia to pełne sprawdzenie, jeśli projekt je ma.

```bash
{{WERYFIKACJA}}
```

## Nietykalne

Lista dla maszyny: z niej `sh tools/docs/lock_org_rules.sh` generuje reguły uprawnień w ustawieniach użytkownika Właściciela, a `check_docs.py` traktuje katalogi `dane` jako istniejące także w worktree. Jedna pozycja na linię: `rodzaj  ścieżka-albo-narzędzie  # opis`. Ścieżki względem korzenia repo, katalog kończy się `/`.

| Rodzaj | Znaczy | Reguła uprawnień |
|---|---|---|
| `dane` | dane lokalne poza gitem: nie usuwasz, nie przenosisz, nie nadpisujesz | `Edit` deny, `rm`/`mv` ask |
| `reczne` | ręczna praca Właściciela: nie zmieniasz bez polecenia | `Edit` deny |
| `generator` | skrypt przebudowujący więcej, niż prosisz | uruchomienie ask |
| `platne` | narzędzie MCP płatne lub limitowane (`mcp__serwer` albo `mcp__serwer__narzędzie`) | ask |

```kokpit-nietykalne
{{NIETYKALNE}}
```

## Dalsze pliki projektu

| Plik | O czym | Czytaj, gdy |
|---|---|---|
{{SPIS}}
