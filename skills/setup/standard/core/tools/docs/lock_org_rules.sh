#!/bin/sh
# core: 0.11.0 (Kokpit repo standard; updated by /kokpit:setup, do not edit by hand)
# Protects .claude/org-rules/ (non-negotiable rules that only the Owner changes) and the project's permission rules.
# Layers and procedure: .claude/org-rules/README.md, section "Protection and change".
#   sh tools/docs/lock_org_rules.sh            # lock: deny/ask rules in the user settings + chmod -R a-w (main checkout)
#   sh tools/docs/lock_org_rules.sh --unlock   # the Owner only, in a terminal: remove the lock and the rules blocking org-rules edits
#   sh tools/docs/lock_org_rules.sh --status   # state; exit 0 = locked with complete rules, 1 = not
#   sh tools/docs/lock_org_rules.sh --print    # print the rules, change nothing
# The rules live in the Owner's ~/.claude/settings.json (outside the repo, so the agent cannot change them with the code):
#   EDIT     deny: editing org-rules, the lock and check_docs.py, recomputing the manifest (removed by --unlock);
#   FIXED    deny: Bash commands writing org-rules, --unlock itself, the approval label (always stay);
#   GIT      ask:  destructive and committing git operations (commit, push, branch switch, reset, clean, --no-verify);
#   PROJECT  deny/ask from the "Protected" section of .claude/org-rules/10-project.md (absolute paths of this repo).
# The project rules the script added are remembered in ~/.claude/kokpit/standard/<repo>.json, so a changed list
# removes only its own entries. chmod applies only in the main checkout: in a worktree a read-only directory would
# block removing the worktree.
set -e
cd "$(dirname "$0")/../.."
DIR=.claude/org-rules
LOCKED_PATHS="$DIR tools/docs/lock_org_rules.sh tools/docs/check_docs.py"
SETTINGS="${ORG_RULES_SETTINGS:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json}"

COMMON=$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .git)" 2>/dev/null && pwd -P || true)
GITDIR=$(git rev-parse --absolute-git-dir 2>/dev/null || true)
if [ -n "$COMMON" ] && [ "${COMMON%/.git}" != "$COMMON" ]; then ROOT=${COMMON%/.git}; else ROOT=$(pwd -P); fi
[ -n "$GITDIR" ] && [ "$(cd "$GITDIR" && pwd -P)" != "$COMMON" ] && WORKTREE=1 || WORKTREE=0

rules() {  # $1 = lock|unlock|status|print
python3 -I - "$1" "$SETTINGS" "$ROOT" "$DIR" <<'PY'
import hashlib, json, os, re, sys

mode, path, root, org = sys.argv[1:5]
EDIT = ["Edit(**/.claude/org-rules/**)", "Edit(**/tools/docs/lock_org_rules.sh)", "Edit(**/tools/docs/check_docs.py)",
        "Bash(*--write-manifest*)"]
EDIT_P = [f"Edit(/{root}/.claude/org-rules/**)", f"Edit(/{root}/tools/docs/lock_org_rules.sh)",
          f"Edit(/{root}/tools/docs/check_docs.py)", f"Edit(/{root}/.claude/worktrees/*/.claude/org-rules/**)"]
FIXED = [
    "Bash(*tee *org-rules*)", "Bash(sed -i*org-rules*)", "Bash(perl -*i*org-rules*)", "Bash(python*org-rules*)",
    "Bash(node*org-rules*)", "Bash(rm *org-rules*)", "Bash(mv *org-rules*)", "Bash(cp *org-rules*)", "Bash(ln *org-rules*)",
    "Bash(chmod *org-rules*)", "Bash(truncate *org-rules*)", "Bash(git checkout*org-rules*)", "Bash(git restore*org-rules*)",
    "Bash(sed -i*lock_org_rules*)", "Bash(sed -i*check_docs.py*)", "Bash(chmod *tools/docs*)",
    "Bash(*lock_org_rules.sh*--unlock*)", "Bash(*org-rules-ok*)",
]
GIT = [
    "Bash(git commit *)", "Bash(git push *)", "Bash(git push)", "Bash(git switch *)", "Bash(git checkout -b *)",
    "Bash(git reset --hard*)", "Bash(git clean *)", "Bash(git branch -D *)", "Bash(git branch -d *)",
    "Bash(git stash drop*)", "Bash(git stash clear*)", "Bash(* --no-verify*)", "Edit(~/.claude/settings.json)",
]
KINDS = {"data": "data", "dane": "data", "manual": "manual", "reczne": "manual",
         "generator": "generator", "paid": "paid", "platne": "paid"}


def project_rules():
    deny, ask = list(EDIT_P), []
    text = ""
    for name in ("10-project.md", "10-projekt.md"):
        p = os.path.join(org, name)
        if os.path.exists(p):
            text = open(p, encoding="utf-8").read()
            break
    m = re.search(r"```kokpit-(?:protected|nietykalne)\n(.*?)```", text, re.S)
    for line in (m.group(1) if m else "").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or "{{" in line:
            continue
        word, _, target = line.partition(" ")
        target = target.strip()
        kind = KINDS.get(word)
        if not kind or not target:
            print(f"NOTE: unknown kind \"{word}\" in Protected (data, manual, generator, paid): {line}")
            continue
        rel = target.strip("/")
        pattern = f"{rel}/**" if target.endswith("/") else rel
        if kind == "data":
            deny.append(f"Edit(/{root}/{pattern})")
            ask += [f"Bash(rm *{rel}*)", f"Bash(mv *{rel}*)"]
        elif kind == "manual":
            deny += [f"Edit(/{root}/{pattern})", f"Edit(/{root}/.claude/worktrees/*/{pattern})"]
        elif kind == "generator":
            ask.append(f"Bash(*{os.path.basename(rel)}*)")
        else:
            ask.append(target)
    return list(dict.fromkeys(deny)), list(dict.fromkeys(ask))


p_deny, p_ask = project_rules()
if mode == "print":
    for group, entries in (("EDIT     deny", EDIT + EDIT_P), ("FIXED    deny", FIXED), ("GIT      ask ", GIT),
                           ("PROJECT  deny", [e for e in p_deny if e not in EDIT_P]), ("PROJECT  ask ", p_ask)):
        for e in entries:
            print(f"  {group}  {e}")
    sys.exit(0)

registry_dir = os.path.join(os.path.dirname(path), "kokpit", "standard")
registry = os.path.join(registry_dir, re.sub(r"[^A-Za-z0-9]", "-", root) + ".json")


def load(p, default):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    json.loads(text)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, p)


data = load(path, {})
permissions = data.setdefault("permissions", {})
deny = permissions.setdefault("deny", [])
ask = permissions.setdefault("ask", [])
before = (list(deny), list(ask))
previous = load(registry, {"deny": [], "ask": []})
others = {"deny": set(), "ask": set()}
for n in (os.listdir(registry_dir) if os.path.isdir(registry_dir) else []):
    if n.endswith(".json") and os.path.join(registry_dir, n) != registry:
        r = load(os.path.join(registry_dir, n), {})
        for key in others:
            others[key].update(r.get(key, []))

if mode == "lock":
    stale_deny = set(previous.get("deny", [])) - set(p_deny) - others["deny"]
    stale_ask = set(previous.get("ask", [])) - set(p_ask) - others["ask"]
    deny[:] = [e for e in deny if e not in stale_deny] + [e for e in EDIT + FIXED + p_deny if e not in deny]
    deny[:] = list(dict.fromkeys(deny))
    ask[:] = [e for e in ask if e not in stale_ask] + [e for e in GIT + p_ask if e not in ask and e not in deny]
    ask[:] = list(dict.fromkeys(ask))
    save(registry, {"root": root, "deny": p_deny, "ask": p_ask})
elif mode == "unlock":
    deny[:] = [e for e in deny if e not in EDIT and e not in EDIT_P]

if (deny, ask) != before:
    if os.path.exists(path):
        with open(path, encoding="utf-8") as src, open(path + ".org-rules.bak", "w", encoding="utf-8") as f:
            f.write(src.read())
    save(path, data)
    print(f"{path}: deny {len(before[0])} -> {len(deny)}, ask {len(before[1])} -> {len(ask)} "
          f"(copy from before the change: {path}.org-rules.bak)")

missing = [e for e in EDIT + EDIT_P + FIXED + p_deny if e not in deny] + [e for e in GIT + p_ask if e not in ask and e not in deny]
if mode in ("lock", "status"):
    total = len(EDIT + EDIT_P + FIXED + p_deny + GIT + p_ask)
    print("rules: complete" if not missing else f"rules: {len(missing)} of {total} missing (first: {missing[0]}; all: --print)")


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


expected = {}
manifest = os.path.join(org, "MANIFEST.sha256")
for line in open(manifest, encoding="utf-8") if os.path.exists(manifest) else []:
    if line.strip():
        digest, name = line.split(None, 1)
        expected[name.strip()] = digest
actual = {f: sha(os.path.join(org, f)) for f in os.listdir(org) if f != "MANIFEST.sha256" and not f.startswith(".")}
if expected != actual:
    print("NOTE: MANIFEST.sha256 does not match the org-rules files. Recompute: python3 tools/docs/check_docs.py --write-manifest"
          " (with protection on, only after --unlock).")
    sys.exit(1)
sys.exit(1 if mode == "status" and missing else 0)
PY
}

case "$1" in
  --unlock)
    if [ ! -t 0 ]; then
      echo "--unlock is run only by the Owner in their own terminal, not by an agent." >&2
      exit 3
    fi
    # shellcheck disable=SC2086
    chmod -R u+w $LOCKED_PATHS 2>/dev/null || true
    rules unlock || true
    echo "org-rules unlocked. After the change: python3 tools/docs/check_docs.py --write-manifest, then sh tools/docs/lock_org_rules.sh"
    ;;
  --status)
    if [ "$WORKTREE" = 1 ]; then echo "chmod: worktree, lock skipped (it applies in the main checkout $ROOT)"
    elif [ -n "$(find "$DIR/README.md" -perm -u=w 2>/dev/null)" ]; then echo "chmod: writable"; STATUS_RC=1
    else echo "chmod: read-only"; fi
    if rules status && [ -z "$STATUS_RC" ]; then echo "LOCKED"; exit 0; fi
    echo "UNLOCKED (or incomplete protection)"
    exit 1
    ;;
  --print)
    rules print
    ;;
  "")
    RC=0
    rules lock || RC=$?
    if [ "$WORKTREE" = 1 ]; then
      echo "Worktree: chmod skipped (the lock applies in the main checkout $ROOT)."
    else
      # shellcheck disable=SC2086
      chmod -R a-w $LOCKED_PATHS
      echo "Locked $LOCKED_PATHS (chmod a-w). Git will not merge changes to these files into this checkout until the Owner removes the lock (--unlock)."
    fi
    exit $RC
    ;;
  *)
    echo "Usage: sh tools/docs/lock_org_rules.sh [--unlock|--status|--print]" >&2
    exit 2
    ;;
esac
