---
name: retro
description: Session retrospective - what in the working environment (instructions, tests, tools, skills, documents) to improve so the next session goes better. Run manually after a session, especially one that went sideways.
disable-model-invocation: true
argument-hint: "[session or handoff thread; empty = current]"
---

# Retro

Based on `retro` from mattpocock/skills (MIT). You improve the **environment**, not the code.

Write the output in the language of the conversation.

Scope: $ARGUMENTS (empty = this session; a thread = a file in `.claude/handoffs/`, including its "tried and dropped" and "user notes and pitfalls" sections).

## Where to look

Go through the session and, for each category, find concrete cases from this session (a quote or a step), not generalities:

- **Navigation** - where did finding a file or piece of information take long? Would a one-line pointer in `AGENTS.md` / `CLAUDE.md` or in a document have shortened it?
- **Automated checks** - which mistake from this session would a test, a `--check` script, a validator or a hook have caught? First check whether such a check already exists and just is not wired in (the project's test runner, a lint or verification script) - that is a finding, not something to write from scratch.
- **Standards** - was the mistake mechanical (a pattern, a banned API, a file location)? Then the fix is a check in code, not a rule in a document. A rule in a document is only for judgments that cannot be automated.
- **Standing instructions** - what in `AGENTS.md` / `CLAUDE.md` changes no behaviour (a no-op), is out of date, or should be a skill loaded on demand?
- **Tool economy** - which calls were expensive (long reads, the full test suite instead of one test, a slow job in the foreground instead of in the background via `/job` or the background tool)?
- **Access to information** - what was missing (an app log, a screenshot, tool output, application state)? How can it be provided permanently?
- **Recurring pitfalls** - what did the user have to correct more than once? A candidate for the "notes" section of a thread or for standing instructions.

## Output

A list of candidates, most serious first. For each: what happened (a concrete detail from the session), the proposed change (a ready snippet or diff), where (the file), and whether it is an automated check or text. You change nothing without consent - the user picks numbers.
