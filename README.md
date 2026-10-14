# Kokpit — pasek nad promptem i handoff zamiast /compact

Mod do Claude Code (terminal i karta **Code** w aplikacji desktopowej, wersja 2.1.287+).
W zwykłym czacie claude.ai i w sesjach chmurowych mody nie rysują — tam działają tylko skille.

```
Kontekst ████████░░ 78% 156k/200k  ·  5h ███░░░░░░░ 31% →14:20  ·  Tydzień █░░░░░░░░░ 13% →pt 09:00  ·  Zadanie ████░░░░░░ 38% 1/4 — Scena
⚑ Kontekst 156k — handoff przy najbliższej przerwie.   [1 Teraz]   [2 Później]
```

## Pasek

Zapełnienie kontekstu, limit 5-godzinny i tygodniowy (z godziną resetu) oraz postęp bieżącego zadania. Postęp liczy się z listy zadań Claude (`TaskCreate`/`TaskUpdate`, starsze `TodoWrite`): ukończone + pół za zadanie w toku. Nowa lista zaczyna się, gdy poprzednia jest cała ukończona. Żeby Claude zakładał listy, mod dopisuje do promptu systemowego jedno zdanie (wyłączasz w `/config`). Bez listy pasek pokazuje „brak listy”.

## Handoff

**Kiedy.** Od progu w tokenach (domyślnie 150k, nigdy później niż przy 75% okna modelu). Trzy tryby w `/config` → Kokpit:

| Tryb | Co się dzieje po przekroczeniu progu |
| --- | --- |
| `przerwa` (domyślny) | Handoff rusza sam na końcu tury, w której nic nie jest w toku albo właśnie ukończyło się zadanie. W połowie roboty czeka. |
| `przycisk` | Tylko pasek z przyciskiem **Handoff**. |
| `auto` | Handoff rusza sam na końcu pierwszej tury po progu. |

Zawsze możesz kliknąć **Teraz** albo **Później** (odkłada o 30k tokenów). Po handoffie kolejny w tej samej sesji dopiero po kolejnych 30k.

**Gdzie.** Jeden plik na **wątek pracy**, nie na czat: `.claude/handoffs/<wątek>.md` (np. `cutscenka-plauen.md`), ciągnięty przez wszystkie sesje tego tematu. Frontmatter `sessions:` wymienia czaty, które do niego pisały.

**Dlaczego nic nie ginie.**
- Sekcje **Decyzje**, **Próbowaliśmy i odpadło** i **Uwagi użytkownika i pułapki** tylko rosną: stare punkty zostają słowo w słowo, nieaktualne idą do **Archiwum** z dopiskiem, czym je zastąpiono.
- Przed zapisem skrypt robi kopię poprzedniej wersji, a walidator porównuje: punkt chroniony, który zniknął bez śladu, to błąd do poprawienia.
- Streszczane są tylko sekcje bieżące: Cel, Stan teraz, Dowody i liczby, Otwarte pytania, Następne kroki, Szybki start.
- **Dziennik** dostaje jeden wpis na handoff; po 15 wpisach najstarsze zwijają się w „Wcześniej: …”.

**Co dalej.** Po zapisie pasek proponuje **Wyczyść i wznów**: Kokpit robi `/clear`, a w nowej sesji sam uruchamia `/wznow` tego wątku. Gdyby silnik nie pozwolił modowi wywołać `/clear`, wpisz je sam — wznowienie i tak ruszy. **Zostań tutaj** zostawia sesję bez zmian.

Jeśli po zapisie rozmowa poszła dalej, pasek pokazuje ⚠ i przycisk **Dopisz, wyczyść i wznów**: najpierw handoff dopisuje to, co doszło, a `/clear` idzie dopiero po udanym zapisie (nieudany albo przerwany handoff niczego nie czyści). Ręczne `/clear` w takim stanie też najpierw dopisuje; żeby wyczyścić bez zapisu, kliknij **Zostań tutaj**, potem `/clear`.

**Tryb planowania i praca w tle.** W trybie planowania handoff nie rusza (nie da się w nim zapisać wątku): pasek pokazuje „Handoff po wyjściu z trybu planowania”, a ręczne `/kokpit:handoff` zostaje odłożone i wraca po wyjściu z planu. `/clear` z przycisku Kokpitu czeka, dopóki pracują agenty albo zadania w tle tej sesji — ich wyniki przyszłyby tylko do niej.

**Siatka bezpieczeństwa.** Gdy mimo wszystko dojdzie do natywnego auto-compactu, Kokpit dokleja mu instrukcję: decyzje, odrzucone podejścia i uwagi przenieść dosłownie, wskazać plik wątku.

**Statystyki.** `/kokpit` — ile handoffów dziś i w tygodniu, w ilu wątkach, przy ilu tokenach średnio. Po tygodniu widać, czy próg jest dobry.

## Rejestr decyzji

Jeden plik na decyzje czekające na Ciebie: `docs/decyzje.md` (ścieżka w `/config` → „Plik rejestru decyzji”). Claude dostaje w prompcie systemowym regułę: decyzję, którą podjął za Ciebie roboczo, albo pytanie, które Ci zostawia, dopisuje tam jako wpis `D-NNN` zamiast „do potwierdzenia” rozsianego po dokumentach.

- W pasku: **Decyzje: N czeka** (klawisz `9` w pustym prompcie) otwiera panel. Komenda: `/decyzje`.
- W panelu przy każdej propozycji: **Przyjmij**, **Odrzuć** albo pole **Inaczej** (Twoja wersja + Enter); przy pytaniu pole **Odpowiedź**. Zapis idzie od razu do pliku (`status`, `rozstrzygnięto`, `odpowiedź`, `wprowadzono: nie`).
- **Wprowadź do dokumentów (N)** wysyła Claude polecenie: przenieś rozstrzygnięcia do dokumentów źródłowych i ustaw `wprowadzono: tak`. Kodu gry przy tym nie zmienia — wypisuje, co by trzeba, i pyta.
- Dokumenty projektu z claude.ai (`claude/*.md`) są poza repo — Claude wypisze, które zaktualizować w czacie.

## Zadania w tle

Długie komendy bez blokowania tury:

| Komenda | Co uruchamia |
| --- | --- |
| `/testy [wzorce]` | `python3 tools/testing/run_tests.py [wzorce]` |
| `/probierz <skrypt> [argumenty]` | Godot headless ze skryptem `tools/balance_spike/<skrypt>.gd` (np. `/probierz full_level malbork sword 5000000 0`). Ścieżka Godota z `$GODOT`, domyślnie `/Applications/Godot.app/...` |
| `/tlo <komenda>` | dowolna komenda powłoki |

Postęp w pasku: `⧗ testy camp · 1:23 · 14/52 ✓ · 1 ✗` z przyciskiem **Stop** (ubija proces z dziećmi). Po końcu: `✓/✗`, nazwy nie zaliczonych testów, **Pokaż Claude** (wkleja wynik i końcówkę logu do rozmowy) i **Ukryj**. Pełny log: `.claude/kokpit/tlo/<id>.log`.

Claude ma też narzędzie `w_tle` (i regułę w prompcie: komendy dłuższe niż ~1 min uruchamia nim). Wraca od razu, Claude pracuje dalej, a po zakończeniu wynik przychodzi do niego sam jako wiadomość od Kokpitu.

## Skille warsztatowe

Przetłumaczone i dostosowane do Zavishy skille z [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, `THIRD_PARTY.md`) — tylko te, które dokładają kontroli albo jakości, bez obowiązkowych bramek:

| Skill | Kiedy |
| --- | --- |
| `/diagnoza` | trudny błąd: najpierw jedna komenda, która świeci na czerwono, potem hipotezy z przewidywaniami, test regresji, sprzątanie |
| `/przeglad [punkt]` | przed commitem: dwa agenty równolegle — Standardy (AGENTS.md, testing.md, tokeny UI, determinizm + zapachy Fowlera) i Specyfikacja (wątek handoffu, decyzje, dokument fazy); domyślnie niezacommitowane zmiany |
| `/retro` | po sesji: co w środowisku (instrukcje, testy, narzędzia) poprawić; tylko propozycje, wybierasz numery |
| `/architektura [obszar]` | w wolnej chwili: raport HTML z miejscami do pogłębienia modułów, potem rozbiór wybranego |
| `/research` | pytanie badane przez agenta w tle na źródłach pierwotnych → `docs/research/<temat>.md` z przypisami |
| `/prototyp` | pytanie nie do rozstrzygnięcia na papierze: symulacja reguły w jednym HTML (z „1000 rozegrań”) albo warianty wyglądu obok siebie |
| `/grill [temat]` | rozbiór planu rundami pytań z rekomendacjami („1 tak, 2 tak, 3: wolę B”), wynik do rejestru decyzji |
| `/grill-me [temat]` | to samo bez zapisu plików, w dowolnym repo i poza kodem; przy temacie spoza Twojego stacku dokłada krótkie „czemu to ważne” i wyciąga decyzje, które w tej technologii podejmuje się domyślnie. Tylko ręcznie |

## Skille

- `/handoff [fokus następnej sesji]` — dopisuje sesję do wątku (albo zakłada nowy wątek) i sprawdza plik walidatorem.
- `/wznow [wątek | ścieżka | id sesji]` — wybiera wątek (domyślnie najnowszy), przypina do niego bieżącą sesję, pokazuje commity od ostatniego zapisu i rusza od kroku 1.

Zapis i edycja `.claude/handoffs/*.md` są zatwierdzane przez mod automatycznie (tylko pliki `.md` wprost w tym katalogu projektu).

## Instalacja (Mac)

1. Plugin leży w `~/Projects/kokpit`.
2. W terminalu:
   ```
   claude plugin marketplace add ~/Projects/kokpit
   claude plugin install kokpit@kokpit
   ```
   Marketplace wskazuje na folder, więc po zmianie plików wystarczy `/reload-plugins`.
3. Sprawdź w sesji: `/plugin` → linia `1 mod active · kokpit`.
4. W repo dodaj do `.gitignore`: `.claude/handoffs/.poprzednie/` i `.claude/kokpit/` (wątki i `docs/decyzje.md` warto commitować).

Do szybkiego testu bez instalacji: `claude --plugin-dir ~/Projects/kokpit`.

## Rozwój

```
claude plugin validate ~/Projects/kokpit
cd ~/Projects/kokpit && claude plugin test      # 56 testów: handoff, rejestr, zadania w tle; terminal + desktop
```
