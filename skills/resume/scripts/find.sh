#!/usr/bin/env bash
# Finds the thread to resume, pins this session to it (adds its id to `sessions:`) and shows what changed
# since the last save. Always exits 0.
#
# Where threads live: `.claude/handoffs/` is usually gitignored, so a worktree session keeps its own copy
# and CLAUDE_PROJECT_DIR (the main checkout) does not see it. Threads are therefore looked up in the
# current checkout first, then in the project directory, then (only for a thread asked for by name or
# session id) in the repo's other worktrees. When the same thread exists in several places, the most
# recently written copy wins and the others are listed.
# A thread asked for by name that is not found is reported – never swapped for the newest one – and the
# session is not pinned anywhere. Pinning removes this session from every other thread, so `/handoff`
# always appends to the one thread being resumed.
PROJECT="${1:-$PWD}"
CURRENT="${2:-}"
WANT="${3:-}"
# "after-clear": Kokpit cleared the conversation on a user message that comes right after (Polish: po-czyszczeniu).
AFTER_CLEAR="${4:-}"

HERE="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$HERE" ] && HERE="$PROJECT"

is_thread() { case "$1" in *.archive.md|*.archiwum.md) return 1 ;; *.md) return 0 ;; *) return 1 ;; esac; }

# Handoff directories without duplicates: NEAR = current checkout + project, ALL = NEAR + other worktrees.
NEAR=""
ALL=""
add_dir() { # $1 = checkout root, $2 = list variable name
  local d="$1/.claude/handoffs"
  [ -d "$d" ] || return 0
  d="$(cd "$d" 2>/dev/null && pwd -P)" || return 0
  local cur
  eval "cur=\"\$$2\""
  case "
$cur
" in *"
$d
"*) return 0 ;; esac
  eval "$2=\"\${$2:+\$$2
}\$d\""
}
add_dir "$HERE" NEAR
add_dir "$PROJECT" NEAR
ALL="$NEAR"
while IFS= read -r wt; do
  [ -n "$wt" ] && add_dir "$wt" ALL
done <<EOF
$(git -C "$HERE" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
EOF

if [ -z "$NEAR$ALL" ]; then
  echo "No .claude/handoffs directory in $HERE or $PROJECT: no handoff has been saved in this project yet."
  exit 0
fi

# Thread files in the given directories, newest first.
threads_in() { # $1 = newline-separated directories
  local d files=""
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    for f in "$d"/*.md; do [ -f "$f" ] && is_thread "$f" && files="$files$f
"; done
  done <<EOF
$1
EOF
  [ -n "$files" ] || return 0
  printf '%s' "$files" | tr '\n' '\0' | xargs -0 ls -1t 2>/dev/null
}
# Where a handoff file lives, relative to the current checkout when possible.
where() {
  local root="${1%/.claude/handoffs/*}"
  local here_real
  here_real="$(cd "$HERE" 2>/dev/null && pwd -P)"
  if [ "$root" = "$here_real" ]; then echo "this checkout"; else echo "$root"; fi
}

# Newest copy of a named thread among the directories ($1 = file name with .md, $2 = directories).
pick_named() {
  threads_in "$2" | while IFS= read -r f; do
    [ "$(basename "$f")" = "$1" ] && { echo "$f"; break; }
  done
}

FILE=""
NOT_FOUND=""
if [ -n "$WANT" ]; then
  if [ -f "$WANT" ]; then FILE="$WANT"
  else
    NAME="$(basename "$WANT")"
    NAME="${NAME%.md}"
    case "$NAME" in *.archive) NAME="${NAME%.archive}" ;; *.archiwum) NAME="${NAME%.archiwum}" ;; esac
    FILE="$(pick_named "$NAME.md" "$ALL")"
    if [ -z "$FILE" ]; then
      # A session id: the thread whose `sessions:` lists it.
      FILE="$(threads_in "$ALL" | while IFS= read -r f; do
        grep -q -m1 "^sessions:.*$WANT" "$f" 2>/dev/null && { echo "$f"; break; }
      done)"
    fi
    [ -z "$FILE" ] && NOT_FOUND="$WANT"
  fi
  # An archive is not a thread: resume the thread itself.
  case "$FILE" in
    *.archive.md) [ -f "${FILE%.archive.md}.md" ] && FILE="${FILE%.archive.md}.md" || FILE="" ;;
    *.archiwum.md) [ -f "${FILE%.archiwum.md}.md" ] && FILE="${FILE%.archiwum.md}.md" || FILE="" ;;
  esac
else
  FILE="$(threads_in "$NEAR" | head -1)"
fi

echo "## threads in the project (newest first)"
SEEN=" "
threads_in "$NEAR" | while IFS= read -r f; do
  b="$(basename "$f")"
  case "$SEEN" in *" $b "*) continue ;; esac # an older copy of a listed thread
  SEEN="$SEEN$b "
  [ "$(echo "$SEEN" | wc -w)" -gt 8 ] && break
  loc="$(where "$f")"
  extra=""; [ "$loc" = "this checkout" ] || extra=" [in $loc]"
  echo "- $(basename "$f"): $(grep -m1 '^# ' "$f" | sed 's/^# //')$extra"
done
echo

if [ -n "$NOT_FOUND" ]; then
  echo "THREAD NOT FOUND: \"$NOT_FOUND\" is not in:"
  echo "$ALL" | sed 's/^/  - /'
  echo "Nothing was pinned. Tell the user and ask which thread to resume (or give a path to the file)."
  exit 0
fi
if [ -z "$FILE" ]; then
  echo "No thread to resume."
  exit 0
fi

echo "CHOSEN THREAD: $FILE"
[ "$(where "$FILE")" = "this checkout" ] || echo "note: the thread lives in another checkout ($(where "$FILE")), not in the current one ($HERE)"
OTHERS="$(threads_in "$ALL" | while IFS= read -r f; do
  [ "$f" != "$FILE" ] && [ "$(basename "$f")" = "$(basename "$FILE")" ] && echo "$f"
done)"
if [ -n "$OTHERS" ]; then
  echo "other (older) copies of this thread — not used:"
  echo "$OTHERS" | sed 's/^/  - /'
fi
if [ "$AFTER_CLEAR" = "after-clear" ] || [ "$AFTER_CLEAR" = "po-czyszczeniu" ]; then
  echo "AFTER CLEAR: the user's message comes right after your answer; report briefly, do not start step 1."
fi
for suffix in .archive.md .archiwum.md; do
  ARCHIVE="${FILE%.md}$suffix"
  [ -f "$ARCHIVE" ] && echo "thread archive: $ARCHIVE ($(wc -c <"$ARCHIVE" | tr -d ' ') B) — open only when something is missing"
done

# Pinning the session to the thread, so /handoff in this session appends to the same file.
# awk instead of sed -i: behaves the same on macOS (BSD) and Linux.
unpin() { # $1 = file; drops the session id from `sessions:` in the frontmatter
  awk -v id="$CURRENT" '
    NR == 1 && $0 == "---" { fm = 1; print; next }
    fm && /^sessions:/ {
      line = $0; sub(/^sessions:[ \t]*\[/, "", line); sub(/\][ \t]*$/, "", line)
      n = split(line, ids, /[ \t]*,[ \t]*/); out = ""
      for (i = 1; i <= n; i++) { gsub(/^[ \t]+|[ \t]+$/, "", ids[i]); if (ids[i] != "" && ids[i] != id) out = out (out == "" ? "" : ", ") ids[i] }
      print "sessions: [" out "]"; next
    }
    fm && $0 == "---" { fm = 0 }
    { print }
  ' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
if [ -n "$CURRENT" ]; then
  threads_in "$ALL" | while IFS= read -r f; do
    [ "$f" = "$FILE" ] && continue
    if grep -q -m1 "^sessions:.*$CURRENT" "$f" 2>/dev/null; then
      unpin "$f" && echo "session $CURRENT unpinned from $f (it now belongs to the chosen thread only)"
    fi
  done
  if ! grep -q "^sessions:.*$CURRENT" "$FILE"; then
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
fi

UPDATED=$(grep -m1 '^updated:' "$FILE" 2>/dev/null | sed 's/^updated:[[:space:]]*//')
echo "last save: ${UPDATED:-unknown date}"
# Git state of the checkout the thread lives in.
ROOT="${FILE%/.claude/handoffs/*}"
[ "$ROOT" = "$FILE" ] && ROOT="$HERE"
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "branch now ($(where "$ROOT/.claude/handoffs/x")): $(git -C "$ROOT" branch --show-current 2>/dev/null)"
  if [ -n "$UPDATED" ]; then
    echo
    echo "## commits since the last save"
    git -C "$ROOT" log --oneline --since="$UPDATED" 2>/dev/null | head -15
  fi
  echo
  echo "## uncommitted changes now: $(git -C "$ROOT" status --short 2>/dev/null | wc -l | tr -d ' ') files"
fi
exit 0
