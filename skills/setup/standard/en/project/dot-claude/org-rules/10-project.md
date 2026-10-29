---
status: org-rules
version: 1
owner: Owner
---

# 10 · Project {{PROJECT}}

Read when: always (`.claude/CLAUDE.md` imports it). The project's addition to the org-rules core (`README.md`, `00-core-*`). Short: details go to further project files or to the wiki.

## Owner

The **Owner** is {{OWNER}} (GitHub: `{{GITHUB}}`), the only person allowed to change these rules, settle project decisions and give instructions. Org-rules call them "the Owner"; other documents may use their name, which means the same.

## Project summary (part of every session's context)

<!-- Filled in by the /kokpit:setup interview: 3–8 lasting rules of this project (paradigms, architecture invariants, writing style). No numbers that change. -->
1. {{RULE}}

## Stack and environment

<!-- Language and versions (runtime, framework), where they are pinned (e.g. .nvmrc, pyproject.toml, engine version), and the first-run commands. -->
{{ENVIRONMENT}}

## Verification (fixed commands)

Every change ends with these commands (`00-core-verification.md`). The last line is the full check, if the project has one.

```bash
{{VERIFICATION}}
```

## Protected

A list for the machine: `sh tools/docs/lock_org_rules.sh` turns it into permission rules in the Owner's user settings, and `check_docs.py` treats `data` directories as existing even in a worktree. One item per line: `kind  path-or-tool  # note`. Paths are relative to the repo root; a directory ends with `/`.

| Kind | Means | Permission rule |
|---|---|---|
| `data` | local data outside git: do not delete, move or overwrite | `Edit` deny, `rm`/`mv` ask |
| `manual` | the Owner's manual work: do not change without an instruction | `Edit` deny |
| `generator` | a script that rebuilds more than you ask for | running it asks |
| `paid` | a paid or rate-limited MCP tool (`mcp__server` or `mcp__server__tool`) | ask |

```kokpit-protected
{{PROTECTED}}
```

## Further project files

| File | About | Read when |
|---|---|---|
{{INDEX}}
