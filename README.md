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

**Kiedy.** Dwa progi w tokenach. **Miękki** (domyślnie 150k, nigdy później niż przy 75% okna): od niego handoff rusza sam, ale tylko po skończonym zadaniu. **Twardy** (domyślnie miękki + 100k, nigdy dalej niż 85% okna): od niego rusza na końcu najbliższej tury, nawet w trakcie pracy, żeby kontekst nie rósł bez końca. Trzy tryby w `/config` → Kokpit:

| Tryb | Co się dzieje po przekroczeniu progu |
| --- | --- |
| `przerwa` (domyślny) | Handoff rusza sam na końcu tury, gdy zadanie jest skończone: cała lista zadań odhaczona i tura nie kończy się pytaniem do Ciebie. Od twardego progu — na końcu najbliższej tury. |
| `przycisk` | Tylko pasek z przyciskiem **Handoff**. |
| `auto` | Handoff rusza sam na końcu pierwszej tury po progu, która nie kończy się pytaniem. |

„Skończone” Kokpit czyta z listy zadań: w terminalu z TaskCreate/TodoWrite, w aplikacji desktopowej z jej własnej listy (`update_plan`, `wrap_up`). Pytanie to `wrap_up` z pytaniem albo odpowiedź, której ostatnia linia kończy się „?”. **Najwyżej jeden automatyczny handoff na rozmowę** — praca w tle, która dobija kontekst, nie sypie kolejnymi. Zawsze możesz kliknąć **Teraz** albo **Później** (odkłada o 30k tokenów).

**Gdzie.** Jeden plik na **wątek pracy**, nie na czat: `.claude/handoffs/<wątek>.md` (np. `cutscenka-plauen.md`), ciągnięty przez wszystkie sesje tego tematu. Frontmatter `sessions:` wymienia czaty, które do niego pisały.

**Dlaczego nic nie ginie.**
- Sekcje **Decyzje**, **Próbowaliśmy i odpadło** i **Uwagi użytkownika i pułapki** tylko rosną: stare punkty zostają słowo w słowo, nieaktualne idą do **Archiwum** z dopiskiem, czym je zastąpiono.
- **Archiwum** i wpisy Dziennika starsze niż ostatnie 8 leżą w osobnym pliku `<wątek>.archiwum.md` (tylko dopisywanym), żeby plik wątku, czytany w całości przy każdym `/wznow`, nie puchł. `/wznow` otwiera archiwum tylko wtedy, gdy czegoś brakuje.
- Przed zapisem skrypt robi kopię poprzedniej wersji wątku i archiwum, a walidator porównuje: punkt chroniony, który zniknął bez śladu (ani w wątku, ani w archiwum), albo punkt, który wypadł z archiwum, to błąd do poprawienia. Powyżej 20 KB walidator radzi odchudzenie.
- Streszczane są tylko sekcje bieżące: Cel, Stan teraz, Dowody i liczby, Otwarte pytania, Następne kroki, Szybki start.
- **Dziennik** dostaje jeden wpis na handoff. Handoff zapisuje wątek edycjami (dopisuje i podmienia sekcje), nie przepisuje go w całości.

**Co dalej — bez klikania.** Po zapisie nic się nie czyści: spokojnie czytasz ostatnie odpowiedzi. Gdy coś napiszesz, Kokpit wstrzymuje tę wiadomość, robi `/clear`, w nowej sesji uruchamia `/wznow` tego wątku (który tylko się zgłasza) i wysyła Twoją wiadomość. Wiadomość napisana w trakcie handoffu czeka na jego koniec i idzie tak samo. Polecenia (`/…`), wiadomości z obrazkami i wiadomości przy pracy w tle przechodzą normalnie, bez czyszczenia. Nieudany handoff oddaje wstrzymaną wiadomość tej rozmowie. Aplikacja desktopowa rysuje wstrzymanie jako czerwone „Prompt blocked by a hook” (opis Kokpitu chowa w „View details”). To nie błąd, więc Kokpit pokazuje ten sam opis toastem, a przy dopisywaniu albo kończeniu handoffu trzyma toast 30 s. Ustawienie `handoffClear: przycisk` wraca do samego przycisku.

**Ostatnie odpowiedzi nie giną.** Przed czyszczeniem Kokpit zapisuje dosłownie dwie ostatnie odpowiedzi Claude (bez tur handoffu) do `.claude/kokpit/ostatnie/<wątek>.md`. W nowej sesji otwiera je w panelu **Poprzednie odpowiedzi** (potem przycisk w pasku albo `/poprzednie`), a model dostaje je jako ukryty kontekst przy Twojej wiadomości — „tak” albo „zrób punkt 2” trafia w to, co było napisane.

**Równoległe sesje.** Magazyn Kokpitu jest wspólny dla wszystkich sesji i projektów, więc wstrzymana wiadomość i „wznów ten wątek” leżą pod kluczem okna rozmowy (`pendingPrompt:<id>`): `/clear` w innej sesji, także w innym repo, ich nie przejmie. Most przez `/clear` jest ważny 5 minut, resztki po zamkniętych oknach znikają po godzinie. Pliki Kokpitu (wątki, ostatnie odpowiedzi, logi zadań w tle, ustawienia, rejestr decyzji) liczą się od korzenia projektu, nie od bieżącego katalogu, który `cd` w Bashu przesuwa; zadania w tle też biegną w korzeniu projektu.

Przycisk **Wyczyść i wznów** zostaje do czyszczenia od razu; gdyby silnik nie pozwolił modowi wywołać `/clear`, wpisz je sam — wznowienie i tak ruszy. **Zostań tutaj** zostawia sesję bez zmian i wyłącza czyszczenie przy następnej wiadomości.

Jeśli po zapisie rozmowa poszła dalej, pasek pokazuje ⚠ i przycisk **Dopisz, wyczyść i wznów**: najpierw handoff dopisuje to, co doszło, a `/clear` idzie dopiero po udanym zapisie (nieudany albo przerwany handoff niczego nie czyści). Ręczne `/clear` w takim stanie też najpierw dopisuje; żeby wyczyścić bez zapisu, kliknij **Zostań tutaj**, potem `/clear`.

**Tryb planowania i praca w tle.** W trybie planowania handoff nie rusza (nie da się w nim zapisać wątku): pasek pokazuje „Handoff po wyjściu z trybu planowania”, a ręczne `/kokpit:handoff` zostaje odłożone i wraca na końcu pierwszej tury po wyjściu z planu. `/clear` z przycisku Kokpitu czeka, dopóki pracują agenty, zadania Kokpitu albo komendy w tle tej sesji — ich wyniki przyszłyby tylko do niej. Pasek pokazuje wtedy „⏳ … wyczyszczę po wynikach pracy w tle”; gdy wszystko skończy, Kokpit dopisuje wyniki do wątku i dopiero potem robi `/clear`. „Zostań tutaj” odwołuje czekanie.

**Siatka bezpieczeństwa.** Gdy mimo wszystko dojdzie do natywnego auto-compactu, Kokpit dokleja mu instrukcję: decyzje, odrzucone podejścia i uwagi przenieść dosłownie, wskazać plik wątku.

**Statystyki.** `/kokpit` — ile handoffów dziś i w tygodniu, w ilu wątkach, przy ilu tokenach średnio, ile automatycznych i ile dopisań przy wiadomości (wątek dopisany przed czyszczeniem, bo rozmowa poszła dalej od zapisu; w dzienniku tryb `dopisanie`). Po tygodniu widać, czy próg jest dobry.

## Narzędzia w tym repo

`/narzedzia` otwiera panel dla bieżącego repo:
- **Graf kodu (graphify)** — ocena z zestawu (pasuje, gdy co najmniej 60% kodu jest w językach, które graphify czyta; w Godocie nie), przycisk **Zainstaluj** / **Włącz w tym repo** / **Wyłącz w tym repo**. Instalacja i włączanie idą w tle (`zestaw.sh`), postęp w pasku.
- **Skille widoczne dla modelu** — przy każdym skillu z konta i `~/.claude/skills` przycisk **Ukryj** / **Pokaż**. Ukryty skill (`skillOverrides: "user-invocable-only"` w `.claude/settings.json`) nie zajmuje kontekstu, a `/nazwa` dalej działa. Skille wtyczek tak się nie ukrywają (wyłącza się całą wtyczkę).
- **Proxy headroom** — tylko informacja: próba w terminalu przez `claude-hr.sh`, bo karta Code w aplikacji je omija.

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

- `/zestaw [maszyna | projekt] [--graphify] [--headroom]` — sprawdza setup tej maszyny i projektu, proponuje komendę, uruchamia ją po Twojej zgodzie. Tylko ręcznie.

## Zestaw (nowa maszyna, nowy projekt)

Ten sam setup na każdym komputerze:

```
gh auth login                                                   # repo Kokpitu jest prywatne
gh repo clone ItsMeLucifer/kokpit_claude_mode ~/Projects/kokpit
~/Projects/kokpit/instaluj.sh                                   # uv, wtyczki, ustawienia Claude Code
```

Potem w każdym projekcie `/kokpit:zestaw` (sprawdza i proponuje) albo wprost `skills/zestaw/scripts/zestaw.sh projekt <katalog>`.

| Co | Skąd | Jak |
| --- | --- | --- |
| uv, claude | — | brak uv → `brew install uv`; brak claude → link do instalacji |
| Wtyczki | `skills/zestaw/scripts/wtyczki.txt` | dodaje marketplace, instaluje brakujące, włącza wyłączone |
| Ustawienia Claude Code | `skills/zestaw/scripts/profil.json` | brakujące klucze dopisuje, różne tylko zgłasza (`--nadpisz` zastępuje), przed zapisem kopia `settings.json.kokpit-<data>`; uprawnień nie rusza |
| Projekt | — | `.gitignore` (kopie walidatora, `.claude/kokpit/`), `.claude/handoffs/`, raport stałego kosztu sesji: CLAUDE.md i duże wątki |
| graphify (opcja) | `wersje.conf` | `--graphify`; w projekcie tylko przy ≥ 60% kodu w językach, które czyta; graf code-only, bez LLM. W projektach Godota nie pasuje |
| headroom (opcja) | `wersje.conf` | `--headroom` instaluje; próba tylko w terminalu przez `claude-hr.sh` (karta Code w aplikacji omija proxy, Remote Control nie działa) |

```
zestaw.sh sprawdz [projekt]                             # niczego nie zmienia
zestaw.sh maszyna [--graphify] [--headroom] [--nadpisz]
zestaw.sh projekt [projekt] [--graphify] [--wymus]
```

Każdy krok jest idempotentny. Dlaczego graphify i headroom są tylko opcjami: `docs/headroom-graphify.md`.

## Instalacja (Mac)

Najprościej: `./instaluj.sh` (sekcja wyżej). Ręcznie:

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
cd ~/Projects/kokpit && claude plugin test      # 89 testów: handoff, rejestr, zadania w tle; terminal + desktop
```
