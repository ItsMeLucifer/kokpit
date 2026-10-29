---
status: org-rules
version: 1
core: 0.10.0
owner: Owner (defined in 10-project.md)
---

# 00 · Knowledge and documentation

Read when: you record something for later, write a document, a rule, a register entry or a handoff thread.

## Knowledge layers (each has one role)

| Layer | Where | Role | Who changes it |
|---|---|---|---|
| org-rules | `.claude/org-rules/` | non-negotiable rules | only the Owner |
| entry | `.claude/CLAUDE.md` (`AGENTS.md` in the root is a link; do not turn it into a regular file) | a map of where things are; short | the agent, carefully |
| area rules | `.claude/rules/*.md` with a `paths:` header | how the code of an area works | the agent, in the same change as the code |
| directory hints | `<directory>/CLAUDE.md` marked "generated" | a pointer to the area rules | only `check_docs.py --hints` |
| wiki | `docs/` with the index `docs/README.md` | how things work and why: rules from decisions, pitfalls, rejected options | the agent |
| decisions | `docs/decisions.md` (open), `docs/archive/decisions-resolved.md` | questions and rulings | the Owner rules |
| work threads | `.claude/handoffs/*.md` | the state of work between sessions (`/handoff`, `/resume`) | the agent |
| agent memory | `MEMORY.md` and memory files | the Owner's preferences and lessons | the agent |

## Rules

1. **A document does not win over the code.** When they disagree, the code is the truth; fix the document. When you change behaviour or architecture, update the area rule or wiki page in the same change.
2. **Lasting knowledge does not live in threads or memory.** A thread is a working file: move a rule, a pitfall or a measurement result to the wiki or a rule and leave a reference.
3. **Memory holds preferences and lessons, not copies of the repo.** An entry that became an org-rule or an area rule is replaced by a reference. Memory grants no permissions that org-rules forbid.
4. **One rule, one place.** You do not repeat a rule in a second file; you refer to it.
5. An area rule has a `paths:` header with globs that match existing files. A rule point reads: rule · where in the code · test · (D-NNN).
6. A wiki page has a header (`status`, `source`, `checked`), a "Read when" line and an entry in the index. Mark uncertainty honestly (`[not found in the code]`, `[the code says otherwise: …]`).
7. A new or moved file leaves no dead links: `python3 tools/docs/check_docs.py` passes without errors.
8. `.claude/CLAUDE.md` is short: the entry and its imports fit the startup budget that `check_docs.py` enforces. Details go to rules and the wiki.

## Decision register

9. A decision you make for the Owner that waits for their confirmation, or a question you cannot settle from the code, is **appended at the end of `docs/decisions.md`**: a heading `## D-NNN · title`, then the lines `- status: pending`, `- type: proposal|question`, `- area: …`, `- proposal: …` (or `- question: …`), `- source: files`, `- added: YYYY-MM-DD`. Other documents get only a reference (D-NNN). The number is the next after the highest.
10. **Only the Owner changes a status** (the `/decisions` pane). **Implemented = accepted:** an implemented decision is closed as accepted and moved to the resolved ones.
11. A resolved entry stays verbatim; you do not rewrite the history of decisions.

## Reading

12. An outline instead of the whole file: in a large file `grep -n` for definitions first, then only the fragments you need. Read the whole file when you change most of it.
