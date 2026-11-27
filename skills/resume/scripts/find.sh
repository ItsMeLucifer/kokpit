#!/usr/bin/env bash
# Finds the thread to resume, pins this session to it (adds its id to `sessions:`) and shows what changed
# since the last save. Always exits 0.
#
# One home for threads: `.claude/handoffs/` of the repo's main checkout (the parent of git's common dir),
# whichever worktree the session runs in. The folder is usually gitignored, so worktrees may hold stale
# copies from before 0.15 (an app copies ignored files into a new worktree): they are never used. A thread
# that exists only in such a copy is moved home when it is resumed; a copy newer than the home thread is
# reported for merging.
# A thread asked for by name that is not found is reported – never swapped for another one – and the
# session is not pinned anywhere. Pinning removes this session from every other thread, so `/handoff`
# always appends to the one thread being resumed.
PROJECT="${1:-$PWD}"
CURRENT="${2:-}"
WANT="${3:-}"
# "after-clear": Kokpit cleared the conversation on a user message that comes right after (Polish: po-czyszczeniu);
# "auto-clear": Kokpit cleared by itself after a finished piece of work, nobody asked for the next step yet.
AFTER_CLEAR="${4:-}"

HERE="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$HERE" ] && HERE="$PROJECT"

# The main checkout: parent of git's common dir; the directory itself outside git.
threads_home() {
  local common
  common="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  [ -z "$common" ] && common="$(cd "$1" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"
  case "$common" in */.git) echo "${common%/.git}" ;; *) echo "$1" ;; esac
}
ROOT_HOME="$(threads_home "$HERE")"
HOME_DIR="$ROOT_HOME/.claude/handoffs"
HOME_REAL="$(cd "$HOME_DIR" 2>/dev/null && pwd -P)"

is_thread() { case "$1" in *.archive.md|*.archiwum.md) return 1 ;; *.md) return 0 ;; *) return 1 ;; esac; }

# Handoff folders of the other checkouts (old copies), without duplicates and without the home.
COPIES=""
add_copy() {
  local d="$1/.claude/handoffs"
  [ -d "$d" ] || return 0
  d="$(cd "$d" 2>/dev/null && pwd -P)" || return 0
  [ "$d" = "$HOME_REAL" ] && return 0
  case "
$COPIES
" in *"
$d
"*) return 0 ;; esac
  COPIES="${COPIES:+$COPIES
}$d"
}
add_copy "$HERE"
add_copy "$PROJECT"
while IFS= read -r wt; do
  [ -n "$wt" ] && add_copy "$wt"
done <<EOF
$(git -C "$HERE" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
EOF

# Thread files in the given directories, newest first.
threads_in() { # $1 = newline-separated directories
  local d files=""
  while IFS= read -r d; do
    [ -n "$d" ] && [ -d "$d" ] || continue
    for f in "$d"/*.md; do [ -f "$f" ] && is_thread "$f" && files="$files$f
"; done
  done <<EOF
$1
EOF
  [ -n "$files" ] || return 0
  printf '%s' "$files" | tr '\n' '\0' | xargs -0 ls -1t 2>/dev/null
}
by_name() { # $1 = file name with .md, $2 = directories; newest match
  threads_in "$2" | while IFS= read -r f; do
    [ "$(basename "$f")" = "$1" ] && { echo "$f"; break; }
  done
}
by_session() { # $1 = session id, $2 = directories
  threads_in "$2" | while IFS= read -r f; do
    grep -q -m1 "^sessions:.*$1" "$f" 2>/dev/null && { echo "$f"; break; }
  done
}

# Moves a thread (and its archive) from an old copy into the home.
move_home() {
  local src="$1" b
  b="$(basename "$src")"
  mkdir -p "$HOME_DIR" || return 1
  mv "$src" "$HOME_DIR/$b" || return 1
  for suffix in .archive.md .archiwum.md; do
    [ -f "${src%.md}$suffix" ] && [ ! -e "$HOME_DIR/${b%.md}$suffix" ] && mv "${src%.md}$suffix" "$HOME_DIR/"
  done
  echo "$HOME_DIR/$b"
}

FILE=""
NOT_FOUND=""
MOVED=""
if [ -n "$WANT" ]; then
  if [ -f "$WANT" ]; then FILE="$WANT"
  else
    NAME="$(basename "$WANT")"
    NAME="${NAME%.md}"
    case "$NAME" in *.archive) NAME="${NAME%.archive}" ;; *.archiwum) NAME="${NAME%.archiwum}" ;; esac
    FILE="$(by_name "$NAME.md" "$HOME_DIR")"
    [ -z "$FILE" ] && FILE="$(by_session "$WANT" "$HOME_DIR")"
    if [ -z "$FILE" ]; then
      OLD="$(by_name "$NAME.md" "$COPIES")"
      [ -z "$OLD" ] && OLD="$(by_session "$WANT" "$COPIES")"
      if [ -n "$OLD" ]; then
        if FILE="$(move_home "$OLD")"; then MOVED="$OLD → $FILE"; else FILE="$OLD"; fi
      fi
    fi
    [ -z "$FILE" ] && NOT_FOUND="$WANT"
  fi
  # An archive is not a thread: resume the thread itself.
  case "$FILE" in
    *.archive.md) [ -f "${FILE%.archive.md}.md" ] && FILE="${FILE%.archive.md}.md" || FILE="" ;;
    *.archiwum.md) [ -f "${FILE%.archiwum.md}.md" ] && FILE="${FILE%.archiwum.md}.md" || FILE="" ;;
  esac
else
  FILE="$(threads_in "$HOME_DIR" | head -1)"
  if [ -z "$FILE" ]; then
    OLD="$(threads_in "$(cd "$HERE/.claude/handoffs" 2>/dev/null && pwd -P)" | head -1)"
    if [ -n "$OLD" ]; then
      if FILE="$(move_home "$OLD")"; then MOVED="$OLD → $FILE"; else FILE="$OLD"; fi
    fi
  fi
fi

echo "threads home: $HOME_DIR"
[ -n "$MOVED" ] && echo "MOVED HOME: $MOVED (all threads of this repo live in the main checkout now; tell the user)"
echo "## threads in the project (newest first)"
threads_in "$HOME_DIR" | head -8 | while IFS= read -r f; do
  echo "- $(basename "$f"): $(grep -m1 '^# ' "$f" | sed 's/^# //')"
done
STRAYS="$(threads_in "$COPIES" | while IFS= read -r f; do [ -f "$HOME_DIR/$(basename "$f")" ] || echo "$f"; done)"
if [ -n "$STRAYS" ]; then
  echo "threads only in old worktree copies (resume one by name to move it home):"
  echo "$STRAYS" | head -8 | sed 's/^/  - /'
fi
echo

if [ -n "$NOT_FOUND" ]; then
  echo "THREAD NOT FOUND: \"$NOT_FOUND\" is not in $HOME_DIR or in any worktree copy:"
  echo "$COPIES" | sed '/^$/d; s/^/  - /'
  echo "Nothing was pinned. Tell the user and ask which thread to resume (or give a path to the file)."
  exit 0
fi
if [ -z "$FILE" ]; then
  echo "No thread to resume."
  exit 0
fi

echo "CHOSEN THREAD: $FILE"
case "$(cd "$(dirname "$FILE")" 2>/dev/null && pwd -P)" in
  "$HOME_REAL"|"$(cd "$HOME_DIR" 2>/dev/null && pwd -P)") ;;
  *) echo "note: the thread lives outside the threads home ($HOME_DIR); a path given on purpose" ;;
esac
NEWER=""
OLDER=""
while IFS= read -r f; do
  [ -n "$f" ] && [ "$(basename "$f")" = "$(basename "$FILE")" ] && [ "$f" != "$FILE" ] || continue
  cmp -s "$f" "$FILE" && { OLDER="$OLDER  - $f (identical)
"; continue; }
  if [ "$f" -nt "$FILE" ]; then NEWER="$NEWER  - $f
"; else OLDER="$OLDER  - $f
"; fi
done <<EOF
$(threads_in "$COPIES")
EOF
if [ -n "$NEWER" ]; then
  echo "NEWER COPY IN A WORKTREE (written there before 0.15): compare it with the chosen thread, carry over what"
  echo "is missing (protected sections, log entries), then tell the user the copy can be deleted:"
  printf '%s' "$NEWER"
fi
[ -n "$OLDER" ] && { echo "old copies of this thread in worktrees (not used, safe to delete):"; printf '%s' "$OLDER"; }
if [ "$AFTER_CLEAR" = "after-clear" ] || [ "$AFTER_CLEAR" = "po-czyszczeniu" ]; then
  echo "AFTER CLEAR: the user's message comes right after your answer; report briefly, do not start step 1."
fi
if [ "$AFTER_CLEAR" = "auto-clear" ]; then
  echo "AUTO CLEAR: Kokpit cleared the conversation by itself after a finished piece of work; report briefly, do not start step 1."
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
  threads_in "$HOME_DIR
$COPIES" | while IFS= read -r f; do
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
# Git state of the checkout this session works in (the thread's work happens here, not in the home).
if git -C "$HERE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  [ "$HERE" != "$ROOT_HOME" ] && echo "this session works in the worktree $HERE"
  echo "branch now: $(git -C "$HERE" branch --show-current 2>/dev/null)"
  if [ -n "$UPDATED" ]; then
    echo
    echo "## commits since the last save"
    git -C "$HERE" log --oneline --since="$UPDATED" 2>/dev/null | head -15
  fi
  echo
  echo "## uncommitted changes now: $(git -C "$HERE" status --short 2>/dev/null | wc -l | tr -d ' ') files"
fi
exit 0
