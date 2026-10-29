#!/usr/bin/env bash
# Finds the thread to resume, pins this session to it (adds its id to `sessions:`) and shows what changed
# since the last save. Always exits 0.
PROJECT="${1:-$PWD}"
CURRENT="${2:-}"
WANT="${3:-}"
# "after-clear": Kokpit cleared the conversation on a user message that comes right after (Polish: po-czyszczeniu).
AFTER_CLEAR="${4:-}"
DIR="$PROJECT/.claude/handoffs"
cd "$PROJECT" 2>/dev/null || true

if [ ! -d "$DIR" ]; then
  echo "No $DIR directory: no handoff has been saved in this project yet."
  exit 0
fi

is_thread() { case "$1" in *.archive.md|*.archiwum.md) return 1 ;; *.md) return 0 ;; *) return 1 ;; esac; }
newest_threads() { for f in $(ls -1t "$DIR"/*.md 2>/dev/null); do is_thread "$f" && echo "$f"; done; }

FILE=""
if [ -n "$WANT" ]; then
  if [ -f "$WANT" ]; then FILE="$WANT"
  elif [ -f "$DIR/$WANT" ]; then FILE="$DIR/$WANT"
  elif [ -f "$DIR/$WANT.md" ]; then FILE="$DIR/$WANT.md"
  else
    for f in $(grep -l -m1 "^sessions:.*$WANT" "$DIR"/*.md 2>/dev/null); do
      if is_thread "$f"; then FILE="$f"; break; fi
    done
  fi
  # An archive is not a thread: resume the thread itself.
  case "$FILE" in
    *.archive.md) [ -f "${FILE%.archive.md}.md" ] && FILE="${FILE%.archive.md}.md" || FILE="" ;;
    *.archiwum.md) [ -f "${FILE%.archiwum.md}.md" ] && FILE="${FILE%.archiwum.md}.md" || FILE="" ;;
  esac
fi
[ -z "$FILE" ] && FILE="$(newest_threads | head -1)"

echo "## threads in the project (newest first)"
for f in $(newest_threads | head -8); do
  echo "- $(basename "$f"): $(grep -m1 '^# ' "$f" | sed 's/^# //')"
done
echo

if [ -z "$FILE" ]; then
  echo "No thread to resume."
  exit 0
fi
echo "CHOSEN THREAD: $FILE"
if [ "$AFTER_CLEAR" = "after-clear" ] || [ "$AFTER_CLEAR" = "po-czyszczeniu" ]; then
  echo "AFTER CLEAR: the user's message comes right after your answer; report briefly, do not start step 1."
fi
for suffix in .archive.md .archiwum.md; do
  ARCHIVE="${FILE%.md}$suffix"
  [ -f "$ARCHIVE" ] && echo "thread archive: $ARCHIVE ($(wc -c <"$ARCHIVE" | tr -d ' ') B) — open only when something is missing"
done

# Pinning the session to the thread, so /handoff in this session appends to the same file.
if [ -n "$CURRENT" ] && ! grep -q "^sessions:.*$CURRENT" "$FILE"; then
  # awk instead of sed -i: behaves the same on macOS (BSD) and Linux.
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
  echo "session $CURRENT pinned to the thread"
fi

UPDATED=$(grep -m1 '^updated:' "$FILE" 2>/dev/null | sed 's/^updated:[[:space:]]*//')
echo "last save: ${UPDATED:-unknown date}"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "branch now: $(git branch --show-current 2>/dev/null)"
  if [ -n "$UPDATED" ]; then
    echo
    echo "## commits since the last save"
    git log --oneline --since="$UPDATED" 2>/dev/null | head -15
  fi
  echo
  echo "## uncommitted changes now: $(git status --short 2>/dev/null | wc -l | tr -d ' ') files"
fi
exit 0
