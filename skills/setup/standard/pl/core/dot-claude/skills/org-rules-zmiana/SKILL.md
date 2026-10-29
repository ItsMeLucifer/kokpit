---
name: org-rules-zmiana
description: Zmiana zasad niepodważalnych (.claude/org-rules/) z polecenia Właściciela – sprawdza, czy ochrona jest zdjęta, wprowadza zmianę, przelicza manifest i przywraca ochronę. Uruchamia tylko Właściciel.
disable-model-invocation: true
argument-hint: "<co zmienić w org-rules>"
---
<!-- rdzen: 0.10.0 (standard repo Kokpitu; aktualizuje /kokpit:setup) -->

# Zmiana org-rules

Zmiana: $ARGUMENTS

Ten skill uruchamia tylko Właściciel. Ochronę zdejmuje on sam w swoim terminalu; Ty jej nie zdejmujesz. Nie wysyłasz `--unlock` do panelu Terminal, nie uruchamiasz kopii skryptu pod inną nazwą, nie edytujesz `~/.claude/settings.json` i nie obchodzisz deny w żaden inny sposób. Procedura i warstwy ochrony: `.claude/org-rules/README.md`, sekcja „Ochrona i zmiana”.

Każde polecenie uruchamiaj osobno, bez łączenia `&&`. Stałe reguły deny dopasowują cały tekst polecenia: `python3 …` z dowolną ścieżką zawierającą „org-rules” zostanie odrzucone.

1. **Stan.** `sh tools/docs/lock_org_rules.sh --status`. Ochrona jest zdjęta, gdy linia `rules:` wymienia brakujące wpisy `Edit(...)`, a `chmod:` mówi „writable”. Przy `LOCKED` zatrzymaj się i podaj Właścicielowi jedno polecenie do jego terminala, z bezwzględną ścieżką checkoutu, w którym pracujesz:
   ```bash
   sh <ścieżka checkoutu>/tools/docs/lock_org_rules.sh --unlock
   ```
   Dalej idziesz dopiero po jego odpowiedzi.
2. **Zmiana.** Przeczytaj README org-rules i pliki, których dotyczy zmiana. Wprowadź dokładnie to, o co prosi Właściciel, nic więcej. Gdy zmiana dotyka zasady ze skrótu, popraw też skrót. W nagłówku każdego zmienionego pliku podnieś `wersja`, chyba że plik ma już niezacommitowaną zmianę z podniesioną wersją. Pliki `00-rdzen-*` są wspólne dla wszystkich repo: zmiana w nich zniknie przy aktualizacji rdzenia, więc zaproponuj Właścicielowi, żeby trafiła do Kokpitu albo do pliku projektu.
3. **Manifest i sprawdzenie.** `python3 tools/docs/check_docs.py --write-manifest`, potem `python3 tools/docs/check_docs.py` (zero błędów).
4. **Przywrócenie ochrony.** `sh tools/docs/lock_org_rules.sh`, potem `--status` (oczekiwane `LOCKED`; w worktree chmod jest pomijany i to jest w porządku). Gdy uruchomienie zostanie zablokowane, poproś Właściciela o `sh tools/docs/lock_org_rules.sh` w jego terminalu.
5. **Próba.** Wywołaj `Edit` na `.claude/org-rules/README.md` z `old_string`, którego w pliku nie ma. Odmowa „denied by your permission settings” oznacza, że ochrona działa. „String not found” oznacza, że deny jeszcze nie działa; zgłoś to wprost.
6. **Raport.** Co zmieniłeś (pliki i zdania), wynik `check_docs.py`, `--status` i próby. Commit tylko na polecenie Właściciela. Zmiana z worktree trafia do głównego checkoutu z zamkiem `chmod`: przed scaleniem Właściciel zdejmuje tam zamek (`--unlock`), po scaleniu wystarczy `sh tools/docs/lock_org_rules.sh`.
