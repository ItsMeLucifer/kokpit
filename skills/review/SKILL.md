---
name: review
description: Review a change along two axes in parallel, Standards (does the code follow the repo's rules) and Spec (does it do what was asked). Use before a commit, after a larger change, or when the user asks for a review of changes since some point.
argument-hint: "[reference point: commit, branch, HEAD~n; empty = uncommitted changes] [spec path]"
---

# Two-axis review

Based on `code-review` from mattpocock/skills (MIT), adapted for repos without an issue tracker.

Write the report in the language of the conversation.

Arguments: $ARGUMENTS

## 1. Establish the reference point

- A commit or branch was given: `git diff <point>...HEAD` plus `git log <point>..HEAD --oneline`.
- None given: uncommitted changes, `git diff HEAD` plus new files from `git status --short`. Work often sits uncommitted, so this is the default case; do not ask for a reference point.

Check that the diff is not empty before launching agents.

## 2. Spec sources (first one that exists)

1. A path from the arguments.
2. The handoff thread file in `.claude/handoffs/` whose `sessions:` contains this session (Goal, Decisions, Next steps).
3. Resolved entries in the decision register (Kokpit's `decisionsFile`, default `docs/decisions.md`) that concern the changed areas.
4. A design or phase document in `docs/` matching the topic of the change.
5. None: the Spec axis reports "no spec" and nothing else.

## 3. Standards sources

Every file that describes how to write code in this repo: `AGENTS.md`, `CLAUDE.md` / `.claude/CLAUDE.md`, the project's testing docs and style or design-system docs, if any, and any other documented conventions the project keeps. Always add the **baseline smells** below. These are judgments, not hard violations, and a documented repo standard always wins.

Smells (Fowler): unclear name, duplicated code, feature envy, data clumps, primitive obsession, repeated `switch`/`if` on the same type, shotgun surgery (one change scattered across many files), divergent change (one file changed for many unrelated reasons), speculative generality, long call chains, middle man that only delegates.

## 4. Two agents in parallel

Launch both at once, in the foreground.

- **Standards:** gets the diff command, the commit list, the list of standards files and the full smell list. Task: per file or hunk, (a) violations of documented standards, quoting the rule (file + rule), (b) smells, quoting the code; separate hard violations from judgments; skip what tests and tooling already enforce. Up to 400 words.
- **Spec:** gets the diff command, the commit list and the spec. Task: (a) what the spec asks for that is missing or half done, (b) what is in the diff that nobody asked for, (c) what looks done but is wrong. Quote the spec for every point. Up to 400 words.

## 5. Report

`## Standards` and `## Spec` separately, without merging or reordering: code can pass one axis and fail the other. End with one line: the number of findings on each axis and the most serious one on each (no picking a single winner between the axes).
