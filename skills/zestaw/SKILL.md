---
name: zestaw
description: Sprawdza i ustawia zestaw Kokpitu na tej maszynie i w bieżącym projekcie — wtyczki, ustawienia Claude Code, .gitignore projektu, stały koszt sesji (CLAUDE.md, wątki handoffu), opcjonalnie graf kodu graphify i próba proxy headroom. Uruchamiaj ręcznie, np. na nowym komputerze albo w nowym repo.
argument-hint: "[maszyna | projekt] [--graphify] [--headroom] [--nadpisz] [--wymus]"
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/zestaw.sh sprawdz *) Read
---

# Zestaw — ten sam setup na każdej maszynie

Polecenie użytkownika (puste = tylko sprawdzenie): $ARGUMENTS

## Stan teraz (sprawdzenie niczego nie zmienia)

!`${CLAUDE_SKILL_DIR}/scripts/zestaw.sh sprawdz ${CLAUDE_PROJECT_DIR}`

## Kroki

1. **Zgłoś stan** w kilku liniach: braki (✗), ostrzeżenia (!) i co z nich wynika. Liczby z sekcji „Stały koszt sesji” podaj wprost (KB i szacowane tokeny).
2. **Zaproponuj komendę** dopasowaną do braków i do `$ARGUMENTS`:
   - maszyna: `${CLAUDE_SKILL_DIR}/scripts/zestaw.sh maszyna [--graphify] [--headroom] [--nadpisz]`
   - projekt: `${CLAUDE_SKILL_DIR}/scripts/zestaw.sh projekt ${CLAUDE_PROJECT_DIR} [--graphify] [--wymus]`
   Powiedz jednym zdaniem, co zmieni (pliki, instalacje). `--nadpisz` zastępuje różniące się ustawienia — proponuj tylko, gdy użytkownik o to prosi.
3. **Uruchom ją dopiero po zgodzie użytkownika** w rozmowie (instaluje narzędzia i zmienia `~/.claude/settings.json` albo pliki projektu). Potem pokaż wynik i ponów sprawdzenie.

## Zasady

- **graphify** tylko w projekcie, któremu sprawdzenie daje „pasuje” (≥ 60% kodu w językach, które czyta). W projektach Godota (GDScript) nie pasuje: hooki kazałyby Claude pytać graf, w którym nie ma głównego kodu. `--wymus` tylko na wyraźną prośbę.
- **headroom** to próba w terminalu (`${CLAUDE_SKILL_DIR}/scripts/claude-hr.sh`), nie stała konfiguracja: karta Code w aplikacji desktopowej omija proxy, a w sesji przez proxy nie działa Remote Control. Nie ustawiaj `ANTHROPIC_BASE_URL` w `settings.json`.
- Uprawnień (`permissions`) zestaw nie rusza — tryb ustawia użytkownik na każdej maszynie.
- Analiza, skąd te zasady: `docs/headroom-graphify.md` w repo Kokpitu.
