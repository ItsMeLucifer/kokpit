---
name: setup
description: Checks and sets up Kokpit on this machine and in the current project: plugins, Claude Code settings, the repo standard (org-rules, a CLAUDE.md entry, protection, check_docs), the fixed per-session cost, optionally the graphify code graph and a headroom proxy trial. One method for an empty repo, a repo with Claude but without the standard, and a compliant one. Run it by hand, e.g. on a new computer or in a new repo.
argument-hint: "[machine | project] [--graphify] [--headroom] [--overwrite] [--tidy] [--force]"
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/setup.sh check *) Bash(${CLAUDE_SKILL_DIR}/scripts/setup.sh standard state *) Read
---

# Setup: the same Claude Code setup on every machine and in every repo

The user's request (empty = only a check): $ARGUMENTS

## Current state (the check changes nothing)

!`${CLAUDE_SKILL_DIR}/scripts/setup.sh check ${CLAUDE_PROJECT_DIR}`

## General steps

1. **Report the state** in a few lines: what is missing (✗), the notes (!), the repo-standard state (A, B or C) and what follows from them. Give the numbers from "Fixed per-session cost" as they are.
2. **Propose a command** that fits what is missing and `$ARGUMENTS`:
   - machine: `${CLAUDE_SKILL_DIR}/scripts/setup.sh machine [--graphify] [--headroom] [--overwrite] [--tidy]`
   - project: `${CLAUDE_SKILL_DIR}/scripts/setup.sh project ${CLAUDE_PROJECT_DIR} [--graphify] [--force]`, then path A, B or C below.
   Say in one sentence what it will change. `--overwrite` replaces differing settings and `--tidy` moves a dead `~/.claude/settings.local.json` to `.bak`: propose them only when the user asks or the check points to them.
3. **Run it only after the user agrees** in the conversation. Then show the result and run the check again.
4. **Background jobs.** When the project has no `.claude/kokpit.json`, offer to create it from the project's real commands: `{"tests": "<test command>", "jobs": {"<name>": "<command with {args}, {1} or {rest}>"}}`. `/tests` and the background tool use it.

## The repo standard: one method, three states

Specification: `${CLAUDE_SKILL_DIR}/../../docs/repo-standard.md`. Tool: `${CLAUDE_SKILL_DIR}/scripts/setup.sh standard <command> ${CLAUDE_PROJECT_DIR}` (below: `S`). Commands: `state`, `init`, `core [--write]`, `rename-entry`, `archive <paths>`, `hook`. The script never overwrites project files without a trace: old versions go to `docs/archive/standard-<date>/` (`docs/archiwum/…` in a Polish repo). You commit nothing.

The standard exists in English and Polish. A repo keeps the language it already follows (`S state` prints it); a new one gets the language from the "Language" section at the end of this skill.

Common to A, B and C:
- **Only the Owner changes org-rules.** When `S state` shows the protection as `LOCKED` and a step changes `.claude/org-rules/`, the lock script or `check_docs.py`, give the Owner one command for their terminal (`sh <repo path>/tools/docs/lock_org_rules.sh --unlock`) and wait. You never run it yourself. At the end `sh tools/docs/lock_org_rules.sh` restores the protection (you may run that).
- After every step run `python3 tools/docs/check_docs.py`. Fix an error from a step before moving on.
- Check once whether Explore and Plan load `CLAUDE.md` in this Claude Code version: run Explore with "Do not read files. Quote the first sentence of the core summary from your context, or write NONE". Report the result; the core assumes they do not (prohibitions go into subagent briefs).

### A · empty (or a skeleton without the interview)

1. Skeleton data: the project name and a one-sentence description (from the repo or by asking), the Owner and the GitHub login (`git config user.name`, the remote; confirm). Ask whether to add the GitHub module (CODEOWNERS, the `docs` workflow and the org-rules guard; without GitHub Pro it is a signal, not a gate).
2. `S init --project "<name>" --owner "<first last>" --github <login> --description "<sentence>" --lang <en|pl> [--github-module]`.
3. **Interview** (short, one question at a time, with suggestions taken from the code): the lasting rules of the project (3–8), the stack and its versions with the first-run commands, the verification commands (tests, lint, build, and the full check if there is one), what is protected (local data outside git, manual work, generators, paid MCP tools), and the "where things are" map for `CLAUDE.md`. Fill in the `{{...}}` in the project file of org-rules and in `.claude/CLAUDE.md`. Create area rules (`.claude/rules/<area>.md` with `paths:`) only for areas the user points out.
4. `python3 tools/docs/check_docs.py --write-manifest`, `python3 tools/docs/check_docs.py --hints`, `python3 tools/docs/check_docs.py` (zero errors), `sh tools/docs/lock_org_rules.sh`, `sh tools/docs/lock_org_rules.sh --status`.

### B · Claude without the standard

First a **difference report** (no changes): what exists (the entry and its size, org-rules and their numbering, rules, skills, hooks, `.gitignore`, memory), what is missing according to `S state`, and where each piece will go. Then a **migration in steps, each with its own consent**; after each one the repo is consistent:

1. **Entry name.** `S rename-entry` (`CLAUDE.MD` → `CLAUDE.md`, the `AGENTS.md` link). Fix the listed files that still use the old name (org-rules only in step 2).
2. **Org-rules** (needs `--unlock` when locked). `S core --write` adds the core files, the core `README.md`, the lock, `check_docs.py` and the change skill. From the existing files: general rules the core already has do not come back (show which ones); project rules go to the project file (Owner, summary, stack and environment, verification, the protected list) and to further files `11-…`, `12-…` with a "Read when" line; old files go through `S archive`. A conflict (a core rule different from the project's) is shown to the Owner with the question which one stays.
3. **Project checks.** Checks from the old `check_docs.py` that the core lacks (e.g. wiki page headers, orphans, moved paths) go to `tools/docs/check_docs_project.py` with a function `check(root, files) -> (errors, warnings)`; the old version is in the archive. Parameters (link scope, skipped directories, local directories) go to `tools/docs/standard.json`.
4. **Entry.** `.claude/CLAUDE.md` imports `@org-rules/README.md` and the project file; it keeps the map and whatever is neither a rule nor an area rule. Rules move to org-rules (step 2), knowledge about areas to `.claude/rules/` with `paths:`. Target: the startup budget from `check_docs.py`. Then `python3 tools/docs/check_docs.py --hints`.
5. **Hook, `.gitignore`, templates.** `S init …` (adds only the missing files: the decision register, `standard.json`, the hook, `.gitignore` entries).
6. **Agent memory.** The memory warnings from `check_docs.py`: replace an entry that copies a rule with a reference, propose removing an entry that grants a permission org-rules forbid (e.g. a standing `--no-verify`). Show every memory change before writing it.
7. **Protection.** `python3 tools/docs/check_docs.py --write-manifest`, `python3 tools/docs/check_docs.py`, `sh tools/docs/lock_org_rules.sh`, `--status`. Deny rules added by hand outside the script earlier: show them to the Owner (`--print` compared with `~/.claude/settings.json`) and propose removing the redundant ones.

### C · compliant

Only a check and proposals: `S core` (a newer core: show the differences with `diff -u` and ask; write with `S core --write` after `--unlock`), the protection rules (`--status`: missing entries), the startup budget, dead globs, directory hints, verification commands, memory warnings. Change nothing without consent.

## Rules

- **graphify** only in a project where the check says "fits" (≥ 60% of the code in languages it reads). In Godot projects (GDScript) it does not fit. `--force` only on an explicit request.
- **headroom** is a terminal trial (`${CLAUDE_SKILL_DIR}/scripts/claude-hr.sh`), not a permanent setup. Do not set `ANTHROPIC_BASE_URL` in `settings.json`.
- The setup does not touch the permission mode (`defaultMode`, `allow`). The standard's `deny` and `ask` rules are written only by the repo's `tools/docs/lock_org_rules.sh`.
- `skillOverrides` for personal and account skills go to `~/.claude/settings.json`, not the project; which ones to hide is the user's call.
- Background on these choices: `docs/headroom-graphify.md` and `docs/repo-standard.md` in the Kokpit repo.
- Talk to the user in the language of the conversation.
