# {{PROJECT}}

{{DESCRIPTION}}

@org-rules/README.md
@org-rules/10-project.md

## Where things are

<!-- A map of the repo: directory → what is in it → the area rule or wiki page. Short; details in .claude/rules/ and docs/. -->
| Where | What | More |
|---|---|---|
| `.claude/org-rules/` | non-negotiable rules | `README.md` |
| `.claude/rules/` | area rules (loaded when working on matching files) | `paths:` header |
| `docs/` | wiki: how things work and why | `docs/README.md` |
| `docs/progress.md` | where the work stands, one line per area | read before starting work in an area |
| `docs/decisions.md` | decisions waiting for the Owner | `/decisions` |
| `.claude/handoffs/` | work threads between sessions | `/handoff`, `/resume` |
{{MAP}}

## Standard tools

- `python3 tools/docs/check_docs.py`: consistency of knowledge and org-rules (a hook runs it after edits in `.claude/` and `docs/`).
- `python3 tools/docs/check_docs.py --hints`: rebuilds the directory hints from the rules' `paths:`.
- `sh tools/docs/lock_org_rules.sh --status`: state of the org-rules protection.
