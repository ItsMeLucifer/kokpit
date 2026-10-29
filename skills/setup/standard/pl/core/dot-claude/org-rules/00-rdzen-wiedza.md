---
status: org-rules
wersja: 1
rdzen: 0.11.0
wlasciciel: Właściciel (definicja w 10-projekt.md)
---

# 00 · Wiedza i dokumentacja

Czytaj, gdy: zapisujesz coś na przyszłość, piszesz dokument, regułę, wpis decyzji albo wątek handoffu.

## Warstwy wiedzy (każda ma jedną rolę)

| Warstwa | Gdzie | Rola | Kto zmienia |
|---|---|---|---|
| org-rules | `.claude/org-rules/` | zasady niepodważalne | tylko Właściciel |
| wejście | `.claude/CLAUDE.md` (`AGENTS.md` w korzeniu to dowiązanie; nie zamieniaj go w zwykły plik) | mapa „co gdzie leży”; krótkie | agent, ostrożnie |
| reguły obszarów | `.claude/rules/*.md` z nagłówkiem `paths:` | jak działa kod danego obszaru | agent, w tej samej zmianie co kod |
| wskazówki katalogów | `<katalog>/CLAUDE.md` z dopiskiem „generated” | odsyłacz do reguł obszaru | tylko `check_docs.py --hints` |
| wiki | `docs/` z indeksem `docs/README.md` | jak to działa i dlaczego: reguły z decyzji, pułapki, odrzucone warianty | agent |
| decyzje | `docs/decyzje.md` (otwarte), `docs/archiwum/decyzje_rozstrzygniete.md` | pytania i rozstrzygnięcia | rozstrzyga Właściciel |
| postęp | `docs/postep.md` | gdzie jest praca: jedna linia na obszar (w toku, zablokowane, ostatnio zrobione) z odsyłaczem do wątku albo strony | agent, przy każdym handoffie |
| wątki pracy | `.claude/handoffs/*.md` | szczegółowy stan jednego nurtu pracy między sesjami (`/handoff`, `/resume`) | agent |
| pamięć agenta | `MEMORY.md` i pliki pamięci | preferencje Właściciela i lekcje | agent |

## Zasady

1. **Dokument nie wygrywa z kodem.** Przy sprzeczności prawdą jest kod; poprawiasz dokument. Zmieniasz zachowanie albo architekturę, poprawiasz regułę albo stronę wiki w tej samej zmianie.
2. **Wiedza trwała nie mieszka w wątkach ani w pamięci.** Wątek jest roboczy: regułę, pułapkę albo wynik pomiaru przenosisz do wiki lub reguły i zostawiasz odsyłacz.
3. **Pamięć to preferencje i lekcje, nie kopie repo.** Wpis, który stał się zasadą org-rules albo regułą, zastępujesz odsyłaczem. Pamięć nie daje zgód, których org-rules zabraniają.
4. **Jedna zasada, jedno miejsce.** Nie powtarzasz zasady w drugim pliku; odsyłasz do niej.
5. Reguła obszaru ma nagłówek `paths:` z globami, które pasują do istniejących plików. Punkt reguły: reguła · gdzie w kodzie · test · dlaczego (D-NNN, incydent, pomiar).
6. Strona wiki ma nagłówek (`status`, `zrodlo`, `sprawdzono`), linię „Czytaj, gdy” i wpis w indeksie. Niepewność oznaczasz uczciwie (`[nie znaleziono w kodzie]`, `[kod mówi inaczej: …]`).
7. Nowy albo przeniesiony plik nie zostawia martwych odsyłaczy: `python3 tools/docs/check_docs.py` przechodzi bez błędów.
8. `.claude/CLAUDE.md` jest krótki: wejście i import org-rules mieszczą się w budżecie startu, który pilnuje `check_docs.py`. Szczegóły idą do reguł i wiki.
9. **Zasada ma powód, a tymczasowa także koniec.** Trwała zasada w pliku projektu albo reguła obszaru mówi, dlaczego istnieje; zasada, która ma wygasnąć, kończy się `(do: RRRR-MM-DD)` albo `(do: <warunek>)`. `check_docs.py` ostrzega o minionych datach. Zasadę bez powodu, sprzeczną z inną albo taką, której usunięcie nie zmieni żadnej decyzji, proponujesz do usunięcia (wpis w rejestrze), zamiast trzymać „na wszelki wypadek”.
10. **Plik postępu odpowiada na „gdzie jesteśmy”.** Jedna linia na obszar we właściwej sekcji (W toku, Zablokowane, Ostatnio zrobione), każda z odsyłaczem do wątku albo strony ze szczegółami. Aktualizujesz go przy każdym handoffie, tylko linie obszarów, nad którymi pracowałeś. Szczegóły zostają w wątku albo na stronie, nie w linii.

## Rejestr decyzji

11. Decyzję, którą podejmujesz za Właściciela i która czeka na jego potwierdzenie, albo pytanie, którego nie rozstrzygniesz z kodu, **dopisujesz na końcu `docs/decyzje.md`**: nagłówek `## D-NNN · tytuł`, potem linie `- status: czeka`, `- typ: propozycja|pytanie`, `- obszar: …`, `- propozycja: …` (albo `- pytanie: …`), `- źródło: pliki`, `- dodano: RRRR-MM-DD`. W innych dokumentach zostawiasz tylko odnośnik (D-NNN). Numer następny po najwyższym.
12. **Status zmienia tylko Właściciel** (panel `/decisions`). **Wdrożone = przyjęte:** wdrożoną decyzję zamyka się jako przyjętą i przenosi do rozstrzygniętych.
13. Rozstrzygnięty wpis zostaje dosłowny; historii decyzji nie przepisujesz.

## Czytanie

14. Zarys pliku zamiast całości: w dużym pliku najpierw `grep -n` po definicjach, potem tylko potrzebne fragmenty. Całość czytasz, gdy zmieniasz większość pliku.
