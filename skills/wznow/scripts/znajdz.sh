#!/usr/bin/env bash
# Znajduje wątek do wznowienia, przypina do niego tę sesję (dopisuje jej id w `sessions:`)
# i pokazuje, co się zmieniło od ostatniego zapisu. Zawsze kod 0.
PROJECT="${1:-$PWD}"
CURRENT="${2:-}"
WANT="${3:-}"
DIR="$PROJECT/.claude/handoffs"
cd "$PROJECT" 2>/dev/null || true

if [ ! -d "$DIR" ]; then
  echo "Brak katalogu $DIR — w tym projekcie nie zapisano jeszcze żadnego handoffu."
  exit 0
fi

FILE=""
if [ -n "$WANT" ]; then
  if [ -f "$WANT" ]; then FILE="$WANT"
  elif [ -f "$DIR/$WANT" ]; then FILE="$DIR/$WANT"
  elif [ -f "$DIR/$WANT.md" ]; then FILE="$DIR/$WANT.md"
  else FILE=$(grep -l -m1 "^sessions:.*$WANT" "$DIR"/*.md 2>/dev/null | grep -v '\.archiwum\.md$' | head -1)
  fi
  # Archiwum wątkiem nie jest (stary Kokpit podawał je jako ostatnio zapisany plik): wznów sam wątek.
  case "$FILE" in
    *.archiwum.md) [ -f "${FILE%.archiwum.md}.md" ] && FILE="${FILE%.archiwum.md}.md" || FILE="" ;;
  esac
fi
if [ -z "$FILE" ]; then
  NAME=$(ls -1t "$DIR" 2>/dev/null | grep '\.md$' | grep -v '\.archiwum\.md$' | head -1)
  [ -n "$NAME" ] && FILE="$DIR/$NAME"
fi

echo "## wątki w projekcie (najnowsze)"
for f in $(ls -1t "$DIR"/*.md 2>/dev/null | grep -v '\.archiwum\.md$' | head -8); do
  echo "- $(basename "$f"): $(grep -m1 '^# ' "$f" | sed 's/^# //')"
done
echo

if [ -z "$FILE" ]; then
  echo "Nie znalazłem wątku do wznowienia."
  exit 0
fi
echo "WYBRANY WĄTEK: $FILE"
ARCHIVE="${FILE%.md}.archiwum.md"
if [ -f "$ARCHIVE" ]; then
  echo "archiwum wątku: $ARCHIVE ($(wc -c <"$ARCHIVE" | tr -d ' ') B) — otwórz tylko, gdy czegoś brakuje"
fi

# Przypięcie sesji do wątku — wtedy /handoff w tej sesji dopisze do tego samego pliku.
if [ -n "$CURRENT" ] && ! grep -q "^sessions:.*$CURRENT" "$FILE"; then
  # awk zamiast sed -i: ma działać tak samo na macOS (BSD) i Linuksie.
  awk -v id="$CURRENT" '
    NR == 1 && $0 == "---" { fm = 1; print; next }
    fm && /^sessions:/ {
      line = $0; sub(/\][ \t]*$/, "", line)
      if (line ~ /\[[ \t]*$/) print line id "]"; else print line ", " id "]"
      done = 1; next
    }
    fm && $0 == "---" { if (!done) print "sessions: [" id "]"; fm = 0; print; next }
    { print }
  ' "$FILE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"
  echo "sesja $CURRENT przypięta do wątku"
fi

UPDATED=$(grep -m1 '^updated:' "$FILE" 2>/dev/null | sed 's/^updated:[[:space:]]*//')
echo "ostatni zapis: ${UPDATED:-nieznana data}"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "gałąź teraz: $(git branch --show-current 2>/dev/null)"
  if [ -n "$UPDATED" ]; then
    echo
    echo "## commity od ostatniego zapisu"
    git log --oneline --since="$UPDATED" 2>/dev/null | head -15
  fi
  echo
  echo "## niezacommitowane zmiany teraz: $(git status --short 2>/dev/null | wc -l | tr -d ' ') plików"
fi
exit 0
