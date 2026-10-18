#!/usr/bin/env bash
# Zestaw Kokpitu — ten sam setup Claude Code na każdej maszynie i w każdym projekcie.
#   zestaw.sh sprawdz [projekt]                             co jest, czego brakuje (niczego nie zmienia)
#   zestaw.sh maszyna [--graphify] [--headroom] [--nadpisz] uv, wtyczki z wtyczki.txt, profil ustawień, opcjonalne narzędzia
#   zestaw.sh projekt [projekt] [--graphify] [--wymus]      .gitignore, katalog wątków, opcjonalnie graf kodu graphify
# Każdy krok jest idempotentny: drugi przebieg mówi „już jest” i niczego nie psuje.
# Pisane pod bash 3.2 (domyślny na macOS): bez tablic asocjacyjnych i ${x,,}.
set -u

TU="$(cd "$(dirname "$0")" && pwd)"
KOKPIT="$(cd "$TU/../../.." && pwd)"
. "$TU/wersje.conf"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
USTAWIENIA="$CLAUDE_DIR/settings.json"

BRAKI=0
ok()       { printf '  ✓ %s\n' "$*"; }
brak()     { printf '  ✗ %s\n' "$*"; BRAKI=$((BRAKI + 1)); }
uwaga()    { printf '  ! %s\n' "$*"; }
naglowek() { printf '\n## %s\n' "$*"; }
ma()       { command -v "$1" >/dev/null 2>&1; }

py() {
  if ma python3; then python3 -I "$TU/zestaw.py" "$@"
  elif ma uv; then uv run --no-project --quiet python -I "$TU/zestaw.py" "$@"
  else brak "brak python3 i uv — nie sprawdzę ustawień"; return 1
  fi
}

# --- wtyczki -----------------------------------------------------------------------------------

wtyczki() { grep -v '^[[:space:]]*#' "$TU/wtyczki.txt" | grep -v '^[[:space:]]*$'; }

marketplace_jest() { claude plugin marketplace list 2>/dev/null | grep -qE "❯ $1( |\$)"; }

# Wypisuje: wlaczona | wylaczona | brak.
wtyczka_stan() {
  claude plugin list 2>/dev/null | awk -v id="$1" '
    $1 == "❯" { w = ($2 == id) }
    w && /Status:/ { print (/enabled/ ? "wlaczona" : "wylaczona"); found = 1; exit }
    END { if (!found) print "brak" }'
}

wtyczki_krok() {
  naglowek "Wtyczki Claude Code"
  while read -r id zrodlo; do
    rynek="${id#*@}"
    [ "$zrodlo" = KOKPIT ] && zrodlo="$KOKPIT"
    if ! marketplace_jest "$rynek"; then
      if [ "$TRYB" = sprawdz ]; then brak "marketplace $rynek ($zrodlo)"; continue; fi
      if claude plugin marketplace add "$zrodlo" >/dev/null 2>&1; then ok "marketplace $rynek dodany ($zrodlo)"
      else brak "marketplace $rynek ($zrodlo) — prywatne repo wymaga zalogowanego gita (gh auth login)"; continue
      fi
    fi
    stan="$(wtyczka_stan "$id")"
    case "$stan" in
      wlaczona) ok "$id" ;;
      wylaczona)
        if [ "$TRYB" = sprawdz ]; then brak "$id wyłączona"
        elif claude plugin enable "$id" >/dev/null 2>&1; then ok "$id włączona"
        else brak "$id — nie dało się włączyć"
        fi ;;
      *)
        if [ "$TRYB" = sprawdz ]; then brak "$id nie zainstalowana"
        elif claude plugin install "$id" >/dev/null 2>&1; then ok "$id zainstalowana"
        else brak "$id — instalacja nie wyszła (claude plugin install $id)"
        fi ;;
    esac
  done < <(wtyczki)
}

# --- narzędzia ---------------------------------------------------------------------------------

# $1 = pakiet PyPI, $2 = przypięta wersja, $3 = specyfikacja do instalacji, $4 = opcjonalnie wersja Pythona.
narzedzie() {
  if uv tool list 2>/dev/null | grep -q "^$1 v$2\$"; then ok "$1 $2"; return; fi
  jest="$(uv tool list 2>/dev/null | awk -v p="$1" '$1 == p { print $2 }')"
  if [ "$TRYB" = sprawdz ]; then brak "$1 ${jest:-brak}, przypięta v$2"; return; fi
  if uv tool install --force ${4:+--python "$4"} "$3" >/dev/null 2>&1; then ok "$1 $2 zainstalowany"
  else brak "$1 — uv tool install $3 nie wyszło"
  fi
}

narzedzia_krok() {
  naglowek "Narzędzia"
  if ma uv; then ok "uv $(uv --version | awk '{print $2}')"
  elif [ "$TRYB" = zmien ] && ma brew && brew install uv >/dev/null 2>&1; then ok "uv zainstalowany przez Homebrew"
  else brak "uv — brew install uv (albo https://docs.astral.sh/uv/getting-started/installation/)"; return 1
  fi
  if ma claude; then ok "claude $(claude --version 2>/dev/null | awk '{print $1}')"
  else brak "claude (Claude Code CLI) — https://code.claude.com/docs/en/setup"; return 1
  fi
  [ "$Z_GRAPHIFY" = 1 ] && narzedzie graphifyy "$GRAPHIFY_WERSJA" "graphifyy==$GRAPHIFY_WERSJA"
  [ "$Z_HEADROOM" = 1 ] && narzedzie headroom-ai "$HEADROOM_WERSJA" "headroom-ai[proxy]==$HEADROOM_WERSJA" "$HEADROOM_PYTHON"
  return 0
}

# Ślady po Headroomie, które zmieniają każdą sesję na maszynie (nie tylko próbną z claude-hr.sh).
headroom_slady() {
  if grep -q 'ANTHROPIC_BASE_URL' "$USTAWIENIA" 2>/dev/null; then
    uwaga "ANTHROPIC_BASE_URL w $USTAWIENIA — terminalowe sesje idą przez proxy, Remote Control i MCP tool search wyłączone"
  fi
  if grep -q '"headroom"' "$HOME/.claude.json" 2>/dev/null; then
    uwaga "serwer MCP headroom zarejestrowany w ~/.claude.json (ładuje się w każdej sesji) — headroom unwrap claude"
  fi
}

maszyna() {
  narzedzia_krok || return 1
  wtyczki_krok
  naglowek "Ustawienia Claude Code ($USTAWIENIA)"
  if [ "$TRYB" = sprawdz ]; then py ustawienia "$USTAWIENIA" "$TU/profil.json" --sprawdz
  else py ustawienia "$USTAWIENIA" "$TU/profil.json" $NADPISZ
  fi
  headroom_slady
}

# --- projekt -----------------------------------------------------------------------------------

dopisz_gitignore() {  # $1 = katalog projektu, $2 = linia
  plik="$1/.gitignore"
  if grep -qxF "$2" "$plik" 2>/dev/null; then ok ".gitignore: $2"; return; fi
  if [ "$TRYB" = sprawdz ]; then brak ".gitignore: brak $2"; return; fi
  # Plik bez końcowego znaku nowej linii skleiłby wpis z ostatnią linią.
  if [ -s "$plik" ] && [ -n "$(tail -c1 "$plik")" ]; then printf '\n' >> "$plik"; fi
  printf '%s\n' "$2" >> "$plik"
  ok ".gitignore: dopisano $2"
}

graphify_krok() {  # $1 = katalog projektu
  naglowek "Graf kodu (graphify)"
  py graf "$1" "$TU/graphify_rozszerzenia.txt"
  pasuje=$?
  if [ -f "$1/graphify-out/graph.json" ]; then ok "graf jest: graphify-out/graph.json"; fi
  if [ "$Z_GRAPHIFY" != 1 ]; then
    [ $pasuje -eq 0 ] && uwaga "pasuje — włączysz: zestaw.sh maszyna --graphify, potem zestaw.sh projekt --graphify"
    return 0
  fi
  if [ $pasuje -ne 0 ] && [ "$WYMUS" != 1 ]; then
    uwaga "pomijam: za mało kodu, który graphify czyta (hooki kierowałyby Claude do grafu bez głównego kodu); wymuś: --wymus"
    return 0
  fi
  [ "$TRYB" = sprawdz ] && return 0
  ma graphify || { brak "graphify nie zainstalowany — zestaw.sh maszyna --graphify"; return 1; }
  # Tylko lokalny AST (bez subagentów i bez tokenów); `graphify install` celowo pomijamy — dopisuje blok
  # do ~/.claude/CLAUDE.md, którego `graphify uninstall` potem nie usuwa.
  if (cd "$1" && GRAPHIFY_NO_CTA=1 GRAPHIFY_BACKEND=none graphify extract . --code-only >/dev/null 2>&1); then ok "graf zbudowany (code-only)"
  else brak "graphify extract . --code-only nie wyszło"; return 1
  fi
  if (cd "$1" && graphify claude install >/dev/null 2>&1); then ok "hooki PreToolUse i sekcja w CLAUDE.md (graphify claude install)"
  else brak "graphify claude install nie wyszło"
  fi
  dopisz_gitignore "$1" "graphify-out/"
  uwaga "po zmianach w kodzie: graphify update . (AST, bez LLM); wycofanie: graphify claude uninstall"
}

projekt() {  # $1 = katalog projektu
  naglowek "Projekt $1"
  [ -d "$1" ] || { brak "nie ma katalogu $1"; return 1; }
  if git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    dopisz_gitignore "$1" ".claude/handoffs/.poprzednie/"
    dopisz_gitignore "$1" ".claude/kokpit/"
  else
    uwaga "to nie repozytorium gita — pomijam .gitignore"
  fi
  if [ -d "$1/.claude/handoffs" ]; then ok "katalog wątków .claude/handoffs/"
  elif [ "$TRYB" = zmien ]; then mkdir -p "$1/.claude/handoffs" && ok "założono .claude/handoffs/"
  else uwaga "brak .claude/handoffs/ (powstanie przy pierwszym /handoff)"
  fi
  naglowek "Stały koszt sesji z plików projektu"
  py rozmiary "$1"
  graphify_krok "$1"
}

# --- wejście -----------------------------------------------------------------------------------

KOMENDA="${1:-sprawdz}"
[ $# -gt 0 ] && shift
Z_GRAPHIFY=0; Z_HEADROOM=0; NADPISZ=""; WYMUS=0; CEL=""
for a in "$@"; do
  case "$a" in
    --graphify) Z_GRAPHIFY=1 ;;
    --headroom) Z_HEADROOM=1 ;;
    --nadpisz)  NADPISZ="--nadpisz" ;;
    --wymus)    WYMUS=1 ;;
    -*) echo "nieznana opcja: $a"; exit 2 ;;
    *)  CEL="$a" ;;
  esac
done
# Sprawdzenie pokazuje też opcjonalne narzędzia, jeśli już są na maszynie.
if [ "$KOMENDA" = sprawdz ]; then
  ma graphify && Z_GRAPHIFY=1
  ma headroom && Z_HEADROOM=1
fi

case "$KOMENDA" in
  sprawdz)
    TRYB=sprawdz
    echo "Zestaw Kokpitu — sprawdzenie (niczego nie zmieniam). Kokpit: $KOKPIT"
    maszyna
    [ -n "$CEL" ] && projekt "$CEL" ;;
  maszyna)
    TRYB=zmien
    echo "Zestaw Kokpitu — maszyna. Kokpit: $KOKPIT"
    maszyna ;;
  projekt)
    TRYB=zmien
    projekt "${CEL:-$PWD}" ;;
  *)
    sed -n '2,6p' "$0"; exit 2 ;;
esac

echo
if [ $BRAKI -eq 0 ]; then echo "Gotowe: brak braków."
else echo "Braki: $BRAKI (✗ wyżej)."
fi
[ "$KOMENDA" = sprawdz ] && exit 0
[ $BRAKI -eq 0 ]
