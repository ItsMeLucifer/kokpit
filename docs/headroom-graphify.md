# Headroom i Graphify — analiza pod Zavishę i handoff

18 X 2026. Wersje: headroom 0.41.0 (HEAD `fbf7bc3`), graphify 0.9.92 (HEAD `86c57be`). Oba repo czytane z klonów, niczego z nich nie uruchamiano. Dokumentacja Claude Code: code.claude.com/docs (llm-gateway, llm-gateway-connect, llm-gateway-protocol, mcp, memory, sub-agents, skills, plugins/install).

## Werdykt

| | Zavisha | Inne projekty | Zastąpi handoff? |
| --- | --- | --- | --- |
| **Headroom** (proxy kompresujące) | nie | tylko próba w terminalu, przy długich logach/JSON | nie |
| **Graphify** (graf kodu) | nie — nie zna GDScriptu | tak, opcjonalnie: Dart/Flutter, Swift, Python, TS, tylko code-only | nie |

Największe oszczędności są gdzie indziej: w tej sesji **~92k tokenów** szło na stały narzut, zanim padło pierwsze polecenie.

## Pomiar: dokąd idą tokeny

Okno kontekstu tej sesji (`get_usage`, Opus 5.5, okno 1M), przy 180k zajętych:

| Kategoria | Tokeny | Co to jest |
| --- | ---: | --- |
| System tools | 27,8k | narzędzia Claude Code |
| MCP tools | 23,4k | serwery MCP i konektory (przeglądarka, terminal, Blender, Higgsfield, SpriteCook, Docs…) |
| Memory files | 21,0k | `.claude/CLAUDE.md` (63 KB, 392 linie) |
| System prompt | 10,4k | |
| Skills | 10,0k | opisy wszystkich skilli: Higgsfield ×9, SpriteCook ×10, anthropic-skills… |
| **Razem przed pracą** | **~92,5k** | płacone w każdej sesji i (poza CLAUDE.md w Explore/Plan) w każdym subagencie |

`zestaw.sh sprawdz` w Zaviszy: 27 wątków handoffu (425 KB), pięć największych ma 24–37 KB, czyli 8–12k tokenów przy każdym `/wznow` (skill czyta wątek w całości).

## Headroom

**Co robi:** lokalne proxy między Claude Code a API. Kompresuje to, co agent czyta (JSON, logi, kod), oryginały trzyma lokalnie do odzyskania (`headroom_retrieve`).

**Dlaczego nie w Twoim trybie pracy:**

1. **Karta Code w aplikacji desktopowej omija proxy.** `headroom/cli/doctor.py:448`: Desktop nadpisuje `ANTHROPIC_BASE_URL` przy starcie sesji agenta (issue #869). Dokumentacja Claude Code mówi to samo: Desktop bierze routing nie z `ANTHROPIC_BASE_URL` ani z `settings.json`, tylko z Developer Mode → „Configure Third-Party Inference”.
2. **Remote Control się wyłącza**, gdy adres API to nie `api.anthropic.com`, a Ty masz `remoteControlAtStartup: true`.
3. **MCP tool search się wyłącza** przy obcym hoście: schematy wszystkich narzędzi MCP ładują się od razu. `headroom wrap` ustawia `ENABLE_TOOL_SEARCH=true`; przy ręcznej konfiguracji łatwo to zgubić i wtedy tokenów przybywa.
4. **W Zaviszy kompresować nie ma czego.**
   - Tryb `cache` (domyślny, żeby nie zrywać cache promptu) odtwarza starsze tury bajt w bajt i kompresuje tylko nowy przyrost. W CHANGELOG sami piszą, że `tokens_saved` jest w tym trybie z założenia prawie zawsze 0.
   - Profil coding nigdy nie kompresuje stratnie odczytów plików (`protect_reads`), a wyniki grep przechodzą bez zmian.
   - W kompresorze AST nie ma GDScriptu.
   - Zostają długie logi testów i Probierza, a te Kokpit i tak trzyma poza kontekstem: `w_tle` oddaje wynik, nie log.
5. **Ryzyka:**
   - CCR potrafi przełączyć odpowiedź z trybu strumieniowego na zwykły (pierwszy token dopiero po całej generacji).
   - Telemetria jest domyślnie włączona.
   - Kopie wyników tool-calli trzyma otwartym tekstem w `~/.headroom/ccr_store.db`.
   - `wrap` rejestruje swój serwer MCP dla całej maszyny (bez `--no-mcp`).
   - Bez `--1m` okno spada do 200k.
   - Błąd cache z subagentami (~4,4× więcej zapisu do cache) jest poprawiony dopiero w niewydanym kodzie.
6. **Pamięć** (`--memory`) to baza faktów w `.headroom/memory.db`. W trybie cache nie jest wstrzykiwana automatycznie. Nie ma decyzji, ślepych uliczek ani kroków. `headroom learn` woła LLM (`claude -p` na Twojej subskrypcji, digest do 80k).

**Kiedy ma sens:** sesje w terminalu z dużymi wynikami JSON/logów (API, SRE), bez Remote Control. Próba bez śladów: `skills/zestaw/scripts/claude-hr.sh`, wynik po kilku sesjach: `headroom savings`.

## Graphify

**Co robi:** parsuje kod tree-sitterem do grafu (`graphify-out/graph.json`), a Claude pyta graf (`graphify query/path/explain`, domyślnie do 2000 tokenów odpowiedzi) zamiast grepować. Hooki PreToolUse popychają go w tę stronę.

**Dlaczego nie w Zaviszy:**

1. **GDScript nieobsługiwany.** W `CODE_EXTENSIONS` (`graphify/detect.py:48`) nie ma `.gd`. Pliki `.gd`, `.tscn`, `.tres` i `.gdshader` lądują w „Unclassified”: nie trafiają do grafu ani do przejścia LLM.
   - W grafie Zavishy byłyby tylko narzędzia: 178 plików `.py`.
   - Poza grafem: 329 `.gd`, 130 `.tres`, 27 `.tscn`, 14 `.gdshader`. W grafie byłoby tylko 26% kodu.
2. **Hooki kierowałyby Claude do grafu bez głównego kodu.** Tekst podpowiedzi zaczyna się od „MANDATORY… You MUST run graphify” i odpala przy Grep i przy Bash z grep/rg/find.
3. **Przejście semantyczne (dokumenty, obrazy) to subagenci Claude na Twojej subskrypcji:** 20–25 plików na subagenta i osobny chunk na każdy obraz. W Zaviszy to 84 pliki `.md` (1,8 MB po polsku) i 945 PNG. Wyszukiwanie jest leksykalne, bez polskiej odmiany i polskich stop-słów.
4. **Worktree:** hooki gita kończą się od razu w dołączonym worktree („canonical graphify-out belongs to the primary checkout”), więc agent w worktree pracowałby na nieaktualnym grafie.
5. **`graphify install` dopisuje blok do `~/.claude/CLAUDE.md`,** którego `graphify uninstall` nie usuwa, i instaluje skill 43,6 KB. Zestaw tego kroku nie robi: używa tylko `graphify claude install` w projekcie.
6. **Pamięć** (`save-result`, `reflect` → `LESSONS.md`) dotyczy pytań zadawanych grafowi, nie wątków pracy. Kodu benchmarków pamięci z README (LOCOMO, LongMemEval) nie ma w repo.

**Gdzie pasuje:** projekty w obsługiwanych językach, w trybie code-only. AST jest lokalny, bez LLM i bez telemetrii. Hook nie blokuje i zawodzi bezpiecznie: limit 10 s, najwyżej 5 podpowiedzi na agenta. Zestaw włącza go tylko tam, gdzie sprawdzenie da ≥ 60% kodu w grafie.

## Handoff — czy da się go zastąpić

| Potrzeba | handoff | headroom | graphify |
| --- | --- | --- | --- |
| Decyzje użytkownika jego słowami | tak | nie | nie |
| Próbowaliśmy i odpadło | tak | nie | częściowo (`dead_end` przy pytaniach do grafu) |
| Następne kroki, szybki start | tak | nie | nie |
| Mniej tokenów w sesji | nie | trochę, tylko w terminalu | tak, w obsługiwanych językach |

Nie da się. Oba narzędzia zmniejszają ilość tokenów, a handoff przenosi wiedzę między sesjami. Co faktycznie psuje handoff, wyszło przy okazji:

- **4 testy Kokpitu nie przechodzą na czystym `HEAD`** (Claude Code 2.1.299, `claude plugin test`: 52/56). Padają dokładnie dwa zabezpieczenia handoffu, w terminalu i w desktopie:
  - „tryb planowania — handoff nie rusza, czeka na wyjście”,
  - „agenty w tle wstrzymują /clear”.
- **Wątki rosną bez końca:** sekcje chronione tylko przybywają, a `/wznow` czyta całość.
- **Przerwany handoff się nie zapisuje.** Tak było w sesji „Ujednolicenie agentów…”, gdzie przerwało go polecenie pusha.

## Proponowany setup

1. **Kokpit z zestawem** (to repo): wtyczki, ustawienia, `.gitignore`, raport stałego kosztu. Nowa maszyna: `instaluj.sh`.
2. **Dieta stałego narzutu** — największy zysk, bez instalowania czegokolwiek:
   - **CLAUDE.md:** 63 KB → migracja do `AGENTS.md` i `docs/systemy/` (już trwa).
     - Dokumentacja Claude Code zaleca poniżej 200 linii. Importy `@` nie zmniejszają kosztu.
     - Leniwe ładowanie daje `.claude/rules/*.md` z `paths:` we frontmatterze: plik ładuje się dopiero, gdy Claude czyta pasujące pliki, np. zasady UI tylko przy `core/ui/**`.
     - Subagenci inni niż Explore i Plan dostają cały CLAUDE.md.
   - **MCP i skille per projekt:** konektory, których projekt nie używa (Higgsfield, SpriteCook, Docs…), wyłączaj w tym projekcie.
     - MCP: `/mcp` (zapis per projekt w `~/.claude.json`) albo `disabledMcpServers`.
     - Skille: `skillOverrides: "off"` w `.claude/settings.local.json`.
     - Koszt wtyczki pokaże `claude plugin details <wtyczka>`; Kokpit to ~0,7k na sesję.
   - **Wątki handoffu:** Archiwum i stary Dziennik do `<wątek>.archiwum.md`. `/wznow` czyta tylko bieżący plik, a walidator ostrzega powyżej 20 KB.
3. **Nawigacja po GDScripcie zamiast graphify:** serwer języka Godota (LSP w edytorze, TCP 6005) jako wtyczka LSP Claude Code, jak `swift-lsp`. Daje definicje i odwołania zamiast grep + Read. Do sprawdzenia prototypem.
4. **graphify:** `--graphify` tylko w projektach, które sprawdzenie uzna za pasujące.
5. **headroom:** `--headroom` tylko jako próba w terminalu (`claude-hr.sh`). `ANTHROPIC_BASE_URL` nigdy w `settings.json`.
