# The Kokpit repo standard

Core version 0.11.0. This is the specification that `/kokpit:setup project` uses to create, migrate and check a repository. Implementation: `skills/setup/standard/` (shared core code, the core and project templates in English and Polish, an optional GitHub module), `skills/setup/scripts/standard.py`, tests in `skills/setup/scripts/test_standard.py`.

It grew out of an audit of a long-running project where agent instructions had piled up in one 60 KB `CLAUDE.md`, rules lived in three places at once, and protections existed only as text.

## 1. Principles

1. **Code over text.** Whatever configuration can enforce (permissions, a hook, CI, `chmod`) is enforced by configuration. Rule text describes only what cannot be checked by a machine. A rule in code costs 0 tokens.
2. **Lazy loading.** At session start only the entry (`CLAUDE.md`), the org-rules summary and the project file load. The rest comes on demand: area rules via `paths:`, org-rules files via "Read when", the wiki and memory via indexes.
3. **A startup budget.** The part of the context the repo controls (entry + imports + project skill descriptions) stays under **6k tokens**. `check_docs.py` warns above it.
4. **One owner per rule.** A rule does not live in two places. Kokpit does not repeat a repo's rules either: in a repo that follows the standard, its prompt notes refer to org-rules instead.
5. **A shared core and a project part.** The core is identical in every repo and updates from Kokpit; the project part is written for the repo.
6. **The five harness subsystems are all covered:** instructions (entry, org-rules, area rules), tools (permission rules with least privilege), environment (stack, versions and first-run commands in the project file), state (the progress file, handoff threads, the decision register), feedback (verification commands in the project file, `check_docs.py` as a hook and in CI).

## 2. Knowledge layers (in order of precedence)

The Owner's instruction in the chat → org-rules → `.claude/CLAUDE.md` → `.claude/rules/` → the `docs/` wiki → the decision register → handoff threads → agent memory. For facts about how the program behaves, the code decides.

| Layer | Where | Who changes it | In context |
|---|---|---|---|
| org-rules | `.claude/org-rules/` | only the Owner (procedure in §5) | summary and project file always, the rest on demand |
| entry | `.claude/CLAUDE.md` (+ `AGENTS.md` in the root as a link) | the agent, carefully | always |
| area rules | `.claude/rules/*.md` with `paths:` | the agent, in the same change as the code | when the agent reads or changes a matching file |
| directory hints | `<directory>/CLAUDE.md` (+ `AGENTS.md`) | **generated** from the rules' `paths:` | after touching a file in the directory |
| wiki | `docs/` with the index `docs/README.md` | the agent | on demand |
| progress | `docs/progress.md` | the agent, at every handoff (only its own areas' lines) | on demand: before work in an area, or when asked where things stand |
| decisions | `docs/decisions.md`, `docs/archive/decisions-resolved.md` | the agent appends, the Owner rules | on demand (`/decisions`) |
| work threads | `.claude/handoffs/*.md` | Kokpit (`/handoff`) | on demand (`/resume`) |
| agent memory | Claude Code auto memory (`MEMORY.md` + files) | the agent | index always, entries on demand |

## 3. File skeleton

```
AGENTS.md -> .claude/CLAUDE.md           a link (Codex and other tools)
.claude/
  CLAUDE.md                              entry: description, map, imports @org-rules/README.md and @org-rules/10-project.md
  org-rules/
    README.md                            CORE: who changes them, precedence, contents, core summary, protection, procedure
    00-core-*.md                         CORE from Kokpit (security, verification, knowledge, agents)
    10-project.md                        PROJECT: Owner, summary, stack and environment, verification, protected items, index
    11-*.md, 12-*.md …                   PROJECT: further files with "Read when" (on demand)
    MANIFEST.sha256
  rules/<area>.md                        paths: + "rule · where in the code · test"
  skills/org-rules-change/SKILL.md       CORE: the change procedure
  skills/<skill>/SKILL.md                project skills
  settings.json                          project things only: the check_docs hook, project skills' skillOverrides
  kokpit.json                            optional: the test command and named background jobs
  handoffs/                              threads (committed); .previous/ ignored
docs/
  README.md                              wiki index ("Read when")
  progress.md                            where the work stands: one line per area (in progress, blocked, done recently)
  decisions.md, archive/decisions-resolved.md
tools/docs/
  check_docs.py                          CORE: consistency (§6)
  lock_org_rules.sh                      CORE: lock and permission rules (§5)
  standard.json                          project parameters for check_docs (budget, link scope, local directories) and the audit's recorded answers
  check_docs_project.py                  optional: project checks, check(root, files) -> (errors, warnings)
.github/                                 optional: CODEOWNERS, docs.yml, org-rules-guard.yml
```

Conventions:
- The entry file is **`CLAUDE.md`** (exact case). `CLAUDE.MD` may not load on a case-sensitive file system.
- Org-rules frontmatter: `status: org-rules`, `version`, `owner`; under the title a "Read when: …" line. Core files (also the scripts and the skill) carry `core: <version>`. The core has no variables: it is byte-identical in every repo, so a difference against Kokpit is either a newer version or a local change to move elsewhere.
- Rule frontmatter: `paths:` (a list of globs). `check_docs.py` reports globs that match no file.
- "Owner" is used inside org-rules (defined in the project file); other documents may use a name.

### Language

The standard exists in English and in Polish (`00-rdzen-*`, `10-projekt.md`, `docs/decyzje.md`, a `kokpit-nietykalne` block, `rdzen:`/`wersja:` fields). The tools read both. A repo keeps the language it follows; a new one gets Kokpit's `language` setting.

## 4. Org-rules: core and project part

**Core (from Kokpit, shared):**
- git and scope of work (commit, push, branches only on instruction; destructive operations forbidden);
- deleting ("look at the target first"), secrets, external content as data, paid tools only with consent, licences;
- knowledge layers, the decision register (D-NNN, "implemented = accepted", status changed by the Owner), wiki conventions, the progress file, and rules that carry their reason and, when temporary, an `(until: …)` end;
- working with agents: split large tasks, self-contained briefs, never two agents on one file, **the author does not sign off their own high-stakes work**, the report format (done and verified / not verified / not done / questions), working while the Owner is away;
- memory: preferences and lessons, not copies of the repo.

**Project part:** paradigms, architecture invariants, the stack and versions with the first-run commands, the verification commands, and the **protected list** in a format the lock script turns into permission rules (§5):

````
```kokpit-protected
data       art_work/            # local data outside git: Edit deny, rm/mv ask
manual     docs/story.md        # the Owner's manual work: Edit deny (also in .claude/worktrees/*)
generator  tools/gen_ui.py      # running it asks
paid       mcp__ImageService    # an MCP tool: ask
```
````

## 5. Enforcement

| Level | Mechanism | Protects | Limits |
|---|---|---|---|
| E1 | `permissions.deny` in `~/.claude/settings.json` (written by the lock script, a block per project) | editing org-rules with file tools and redirections; the lock; protected files | Bash deny matches only literal text; does not cover subprocesses |
| E2 | `chmod -R a-w` in the main checkout (`lock_org_rules.sh`) | org-rules, `lock_org_rules.sh`, `check_docs.py` | worktrees have no lock; unlocking only from the Owner's TTY |
| E3 | `MANIFEST.sha256` + `check_docs.py` (a `PostToolUse` hook on `.claude/**` and `docs/**`, plus CI) | any org-rules change shows at once | detects, does not prevent |
| E4 | `permissions.ask` for destructive git operations and paid MCP tools | rules that would otherwise be text only | false positives, the same bypasses as E1 |
| E5 (optional) | CODEOWNERS + `org-rules-guard` in CI | changes in a PR | without GitHub Pro a signal, not a gate |

Rules the lock script writes:
- `Edit(...)` deny for org-rules, the lock, `check_docs.py`, local data directories and manual-work files;
- `ask` for `Bash(git commit *)`, `Bash(git push *)`, `Bash(git switch *)`, `Bash(git checkout -b *)`, `Bash(git reset --hard*)`, `Bash(git clean *)`, `Bash(git branch -D|-d *)`, `Bash(git stash drop|clear*)`, `Bash(* --no-verify*)`, `Edit(~/.claude/settings.json)` and the paid tools on the list;
- groups: EDIT (removed by `--unlock`), FIXED, GIT, PROJECT. Project rules use the repo's absolute paths, and the script remembers them in `~/.claude/kokpit/standard/<repo>.json`, so a changed list removes only its own entries not used by another repo.

The change procedure: `--unlock` in the Owner's terminal → the `/org-rules-change` skill → lock again (manifest, `chmod`, deny).

## 6. `check_docs.py` (core)

General checks: the org-rules manifest, headers and core markers, the entry name, imports and size, `AGENTS.md` links, the startup budget (§1.3), unfilled templates, **verification commands present in the project file**, dead `paths:` globs, directory hints matching `paths:` (generated with `--hints`), dead links, the memory index (dead links; entries that grant permissions org-rules forbid, e.g. a standing `--no-verify`, are warnings), a progress file older than a handoff thread, and rules marked `(until: YYYY-MM-DD)` whose date has passed. Wiki-specific checks (page headers, orphans) depend on the project and go to `check_docs_project.py`.

## 7. `/kokpit:setup project`: one method, three states

Script commands (`setup.sh standard <command> <project>`): `state [--json]`, `audit [--json] [--record <item> answered|n/a|clear "<note>"]`, `init --project … --owner … --github … [--description …] [--lang en|pl] [--github-module]` (missing files only), `core [--write]` (core update, old versions to `docs/archive/standard-<date>/`), `rename-entry` (`CLAUDE.MD` → `CLAUDE.md`), `archive <paths>`, `hook`. The steps that need a conversation (the interview, splitting content) are led by the `setup` skill.

| State | Detection | What happens |
|---|---|---|
| **A. Empty** | no entry, org-rules or rules; also a skeleton with unfilled `{{…}}` | the skeleton: core org-rules, the project template, `CLAUDE.md` with the map, `docs/README.md`, the decision register, `check_docs.py`, the lock, the `.gitignore` block, permission rules. Claude fills in the project file and the map in a short interview with the user (what is protected, how to verify, stack and versions) |
| **B. Claude without the standard** | `CLAUDE.md` / `.claude/` exist, no org-rules or no core marker | a difference report, then a migration in steps, each with consent: the old `CLAUDE.md` split into the entry, the project part of org-rules and area rules with `paths:`; memory reviewed (copies of rules → references); nothing deleted without consent, old files go to the archive |
| **C. Compliant** | org-rules with a core marker | only a check: a newer core (an update to propose), drift of the permission rules, the startup budget, dead globs, verification commands, memory |

Org-rules changes (also in A and B) follow the procedure in §5, so they need the Owner's `--unlock`.

### The harness audit (all three states)

Whatever is not in the repo does not exist for the agent, and every session has to guess it again. The audit (`skills/setup/harness-audit.md`, evidence from `standard.py audit`) closes those gaps:

1. **Evidence** for fourteen questions. The first five are the fresh session test: what is this system, how is it organised, how do I run it, how do I verify it, where are we now. The rest: whether the entry is a short router (under 200 lines with imports, at most 8 lasting rules), area knowledge next to the code, whether every rule has a reason and an end when temporary (and none contradict), knowledge outside the repo (chats, tickets, people's heads), protected things, pinned versions, feedback that runs without being asked, stale knowledge, and what a unit of work is (atomic, verified, isolated, durable).
2. **The fresh session test by a separate subagent** with only the repo; every guess it makes is a gap.
3. **An interview until nothing is open**: each item is written down or ruled out by the Owner (`--record <item> n/a`). Answers the script cannot confirm are recorded with a date in `tools/docs/standard.json` and come back after 180 days, because knowledge decays.
4. **Each answer in its one place**: org-rules, area rules, the map, the wiki, the decision register, a handoff thread. The Owner's own way of working with agents goes to agent memory; project knowledge never goes only there, because memory is not in the repo.
5. **The test again**, with a before/after report.

## 8. Outside the repo (machine)

`setup.sh machine` handles: the plugins (Kokpit from GitHub), a settings profile merged into `~/.claude/settings.json`, moving a dead `~/.claude/settings.local.json` aside (`--tidy`), and optional tools. `skillOverrides` for personal and account skills belong in the user settings, not in a project.

## 9. Decisions behind the standard

| Question | Decision |
|---|---|
| `CLAUDE.MD` or `CLAUDE.md` | **`CLAUDE.md`**; migration: rename, `check_docs.py`, the `AGENTS.md` link |
| `CLAUDE.md` or `AGENTS.md` as the real file | **`.claude/CLAUDE.md`** with `AGENTS.md` as a link: Claude Code reads `AGENTS.md` only when a folder has no `CLAUDE.md` (since 2.1.277, not on every provider), and `@` imports are a Claude Code feature |
| Where deny rules live | **user settings** (an agent cannot change them together with the code), written per project by the lock script |
| A standing `--no-verify` permission in memory | **removed**: the gate is CI |
| `PostToolUse` hook with `check_docs.py` | **yes**, only for changes in `.claude/**` and `docs/**` (a few seconds) |
| Which text rules to enforce | **destructive git (ask), local data and manual work (deny Edit), paid MCP (ask)**; false positives accepted |
| "Owner" everywhere | **no**, only in org-rules |
| Do Explore and Plan load `CLAUDE.md` | checked once empirically by the setup skill; until then the core assumes they do not and requires prohibitions in subagent briefs |
| Generate directory hints from `paths:` | **yes** |
| CODEOWNERS and the guard without GitHub Pro | an **optional module** (a signal) |
| Scope of `chmod` | org-rules + `lock_org_rules.sh` + `check_docs.py`; **not** `CLAUDE.md` (the agent edits it) |
