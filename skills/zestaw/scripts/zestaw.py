"""Pomocnik zestawu Kokpitu (wołany z zestaw.sh). Tylko biblioteka standardowa.

  zestaw.py ustawienia <settings.json> <profil.json> [--sprawdz] [--nadpisz]
      Dokłada profil do ustawień Claude Code: brakujące klucze dopisuje, różne tylko zgłasza
      (z --nadpisz zastępuje). Przed zapisem kopia obok pliku. Z --sprawdz niczego nie zapisuje.
  zestaw.py graf <projekt> <rozszerzenia.txt>
      Ile kodu projektu czyta parser AST graphify, a ile wypadnie z grafu. Kod wyjścia 0 = pasuje.
  zestaw.py rozmiary <projekt>
      Stały koszt sesji z plików projektu: CLAUDE.md/AGENTS.md (ładowane w całości) i wątki handoffu.
"""
import json
import shutil
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

# Rozszerzenia kodu, których graphify nie zna — liczone, żeby było widać, co wypadnie z grafu.
# (.json, .sh i .md graphify czyta, ale to nie jest „kod projektu”, więc nie wchodzą do proporcji).
KOD_NIEOBSLUGIWANY = {
    'gd', 'gdshader', 'gdshaderinc', 'tscn', 'tres', 'shader', 'glsl', 'hlsl', 'wgsl', 'hx', 'nim', 'cr', 'odin', 'gleam',
}
POMOCNICZE = {'json', 'sh', 'bash', 'md', 'txt', 'yaml', 'yml', 'html'}
PROG_GRAFU = 0.6
# Szacunek: tekst polski z diakrytykami to ok. 3 bajty UTF-8 na token.
BAJTY_NA_TOKEN = 3
LIMIT_LINII_CLAUDE_MD = 200  # zalecenie z dokumentacji Claude Code (memory)
DUZY_WATEK = 20_000


def ustawienia(cel_sciezka: str, profil_sciezka: str, sprawdz: bool, nadpisz: bool) -> int:
    cel_plik = Path(cel_sciezka).expanduser()
    cel = json.loads(cel_plik.read_text()) if cel_plik.exists() else {}
    profil = json.loads(Path(profil_sciezka).read_text())
    profil.pop('_opis', None)
    dopisane: list[str] = []
    rozne: list[tuple[str, object, object]] = []

    def scal(c: dict, p: dict, sciezka: str) -> None:
        for k, v in p.items():
            klucz = f'{sciezka}.{k}' if sciezka else k
            if k not in c:
                c[k] = v
                dopisane.append(klucz)
            elif isinstance(v, dict) and isinstance(c[k], dict):
                scal(c[k], v, klucz)
            elif c[k] != v:
                rozne.append((klucz, c[k], v))
                if nadpisz:
                    c[k] = v

    scal(cel, profil, '')
    for k in dopisane:
        print(f'  + {k}')
    for k, jest, chce in rozne:
        znak = '~' if nadpisz else '≠'
        print(f'  {znak} {k}: jest {json.dumps(jest, ensure_ascii=False)}, profil {json.dumps(chce, ensure_ascii=False)}')
    zmiana = bool(dopisane) or (nadpisz and bool(rozne))
    if not dopisane and not rozne:
        print('  zgodne z profilem')
    if sprawdz or not zmiana:
        return 0
    if cel_plik.exists():
        # Dwa zapisy w tej samej sekundzie nie mogą nadpisać pierwszej kopii (to ona ma oryginał).
        znacznik = time.strftime('%Y%m%d-%H%M%S')
        kopia = cel_plik.with_name(f'{cel_plik.name}.kokpit-{znacznik}')
        n = 1
        while kopia.exists():
            n += 1
            kopia = cel_plik.with_name(f'{cel_plik.name}.kokpit-{znacznik}-{n}')
        shutil.copy2(cel_plik, kopia)
        print(f'  kopia: {kopia}')
    cel_plik.parent.mkdir(parents=True, exist_ok=True)
    cel_plik.write_text(json.dumps(cel, ensure_ascii=False, indent=2) + '\n')
    print(f'  zapisano {cel_plik}')
    return 0


def pliki_projektu(projekt: Path) -> list[str]:
    try:
        wynik = subprocess.run(['git', '-C', str(projekt), 'ls-files'], capture_output=True, text=True, check=True)
        return wynik.stdout.splitlines()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [str(p.relative_to(projekt)) for p in projekt.rglob('*') if p.is_file() and '.git' not in p.parts]


def graf(projekt_sciezka: str, rozszerzenia_sciezka: str) -> int:
    projekt = Path(projekt_sciezka)
    znane = {
        l.strip().lstrip('.').lower()
        for l in Path(rozszerzenia_sciezka).read_text().splitlines()
        if l.strip() and not l.startswith('#')
    }
    licznik = Counter(Path(p).suffix.lstrip('.').lower() for p in pliki_projektu(projekt) if Path(p).suffix)
    czyta = {e: n for e, n in licznik.items() if e in znane and e not in POMOCNICZE}
    nie_czyta = {e: n for e, n in licznik.items() if e in KOD_NIEOBSLUGIWANY}
    razem = sum(czyta.values()) + sum(nie_czyta.values())
    udzial = sum(czyta.values()) / razem if razem else 0.0

    def opis(d: dict) -> str:
        return ', '.join(f'.{e} {n}' for e, n in sorted(d.items(), key=lambda x: -x[1])) or '—'

    print(f'  czyta (AST, bez LLM): {opis(czyta)}')
    print(f'  wypada z grafu:       {opis(nie_czyta)}')
    print(f'  udział kodu w grafie: {udzial:.0%} (próg {PROG_GRAFU:.0%})')
    return 0 if razem and udzial >= PROG_GRAFU else 1


def rozmiary(projekt_sciezka: str) -> int:
    projekt = Path(projekt_sciezka)
    # Te Claude Code ładuje w całości na starcie każdej sesji (i każdego subagenta poza Explore/Plan).
    # .claude/CLAUDE.md i .claude/CLAUDE.MD to na macOS ten sam plik, a AGENTS.md bywa dowiązaniem — licz raz.
    # Klucz to i-węzeł: na macOS resolve() nie ujednolica wielkości liter (CLAUDE.md vs CLAUDE.MD).
    widziane: dict[tuple[int, int], str] = {}

    def wezel(p: Path) -> tuple[int, int]:
        st = p.stat()
        return st.st_dev, st.st_ino

    for nazwa in ('CLAUDE.md', '.claude/CLAUDE.md', '.claude/CLAUDE.MD', 'CLAUDE.local.md'):
        plik = projekt / nazwa
        if not plik.exists() or wezel(plik) in widziane:
            continue
        widziane[wezel(plik)] = nazwa
        bajty = plik.stat().st_size
        linie = plik.read_text(errors='replace').count('\n')
        znak = '!' if linie > LIMIT_LINII_CLAUDE_MD else '✓'
        print(f'  {znak} {nazwa}: {linie} linii, {bajty // 1024} KB ≈ {bajty // BAJTY_NA_TOKEN // 1000}k tokenów w każdej sesji')
    agents = projekt / 'AGENTS.md'
    if agents.exists():
        if wezel(agents) in widziane:
            print(f'  ✓ AGENTS.md: ten sam plik co {widziane[wezel(agents)]} (dla Codexa; Claude Code liczy go raz)')
        else:
            print(f'  ✓ AGENTS.md: {agents.stat().st_size // 1024} KB (Claude Code go nie ładuje, chyba że CLAUDE.md go importuje)')
    # Pliki archiwum (<wątek>.archiwum.md) /wznow czyta tylko wtedy, gdy czegoś brakuje — nie liczą się do kosztu.
    watki = sorted(
        (p for p in (projekt / '.claude/handoffs').glob('*.md') if not p.name.endswith('.archiwum.md')),
        key=lambda p: -p.stat().st_size,
    )
    if watki:
        duze = [p for p in watki if p.stat().st_size > DUZY_WATEK]
        print(f'  wątki handoffu: {len(watki)}, razem {sum(p.stat().st_size for p in watki) // 1024} KB')
        for p in duze[:5]:
            kb = p.stat().st_size
            print(f'  ! {p.name}: {kb // 1024} KB ≈ {kb // BAJTY_NA_TOKEN // 1000}k tokenów przy każdym /wznow')
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd, args = argv[1], [a for a in argv[2:] if not a.startswith('--')]
    flagi = {a for a in argv[2:] if a.startswith('--')}
    if cmd == 'ustawienia' and len(args) == 2:
        return ustawienia(args[0], args[1], '--sprawdz' in flagi, '--nadpisz' in flagi)
    if cmd == 'graf' and len(args) == 2:
        return graf(args[0], args[1])
    if cmd == 'rozmiary' and len(args) == 1:
        return rozmiary(args[0])
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
