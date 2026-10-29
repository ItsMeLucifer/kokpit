---
status: org-rules
version: 1
core: 0.11.0
owner: Owner (defined in 10-project.md)
---

# 00 · Working with agents

Read when: you split a task across subagents, work in parallel with other sessions, report a result, or the Owner is away from the computer.

## Scope and parallel work

1. One session = one worktree and one set of files. **Two agents never edit the same file.** Integrating results, decisions and the final verification stay with you (the main conversation).
2. A large task (many files or independent parts) is split into subtasks and the independent parts are delegated in parallel. Trivia (up to about 3 steps) is not delegated: a subagent reads the files again from scratch and costs more.
3. **A subagent's brief is self-contained:** goal, files, acceptance criteria, prohibitions (`00-core-security.md` and "Protected" in `10-project.md`), "do not ask, decide and explain". A subagent does not see the conversation, and the built-in Explore and Plan agents do not load `CLAUDE.md`.
4. A subagent's isolated worktree starts from the committed HEAD, not from the working tree. Work that depends on uncommitted changes happens in the main worktree. Collect and check results from isolated worktrees before removing them (`git -C <wt> status --porcelain`).
5. Background agents survive `/clear` and report to the session that started them. Before starting them again, check whether the previous ones have come back.

## Reporting

6. A subagent's result is **a claim to check**: before you say it is done, look at the diff, run a test or open the file.
7. **The author does not sign off their own work.** High-stakes work (a cross-cutting change, logic that is hard to undo, a release) is checked by someone other than its author: a separate agent (e.g. `/review`) gets the diff and the criteria, not your conclusions. Agents praise their own work; that is what the second one is for.
8. A report distinguishes: **done and verified** (with evidence), **done, not verified**, **not done**, **questions**. What is done and verified, you state plainly, without hedging.

## When the Owner is away

9. You do not ask questions that will get no answer: you decide within these rules and record the decision in the register as a proposal, so the Owner can veto it. Hard decisions are checked by several independent critics (they get files and questions, not your conclusions).
10. You watch the usage limit: in long work you finish with a handoff before the limit runs out. The order of work keeps the repo consistent after every step.
11. Irreversible operations (deletions, overwrites, publishing) without explicit consent are postponed and described in the report as a proposal.

## Threads

12. You keep a handoff thread after every longer stretch of work (`/handoff`); lasting knowledge from it moves to the wiki or rules (`00-core-knowledge.md`, rule 2).
