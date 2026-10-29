---
name: handoff
description: Saves the state of the work to a thread file (.claude/handoffs/<thread>.md) that carries on across the sessions of one topic, so a fresh session after /clear picks the work up without guessing. A replacement for /compact. Use when the user says "handoff", "save the state", "let's stop for today", "the context is filling up", or when Kokpit starts it from the button or automatically.
argument-hint: "[what the next session should focus on]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/state.sh *) Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/check_handoff.py *) Read Write(.claude/handoffs/*) Edit(.claude/handoffs/*) Edit(docs/progress.md) Edit(docs/postep.md) Edit(PROGRESS.md) Edit(docs/archive/progress-done.md) Edit(docs/archiwum/postep-zrobione.md) Write(docs/archive/progress-done.md) Write(docs/archiwum/postep-zrobione.md)
---

# Handoff: appending this session to its thread

You write for your future self: the next session does not see this conversation, only the thread file and the repository. What counts is what **cannot be rebuilt from the code**: decisions, dead ends, measured numbers and what the user corrected.

One thread = one topic of work (e.g. `checkout-retry`), one file across all sessions. The file **grows** instead of being rewritten, so details do not get lost over successive handoffs.

Focus of the next session (may be empty): $ARGUMENTS

## Project state (collected before the skill started)

!`${CLAUDE_SKILL_DIR}/scripts/state.sh ${CLAUDE_SESSION_ID} ${CLAUDE_PROJECT_DIR}`

## When not to write

- **Plan mode** (writes blocked except the plan file): do not save the session state anywhere, not to the plan file either. Say in one sentence that the handoff starts after plan mode ends, and get back to work.

## Steps

1. **Pick the thread.**
   - The script printed "THREAD OF THIS SESSION: <file>" → write to that file.
   - "none" → if this session continues one of the listed threads, use it; otherwise start a new one: `.claude/handoffs/<short-ascii-slug>.md` (e.g. `terrain-mud`, `ui-cards`). Either way add `${CLAUDE_SESSION_ID}` to `sessions:` in the frontmatter.
   - The session covered two independent topics → two threads, each with its own part.
2. **Go through the whole conversation** with the checklist below before writing anything. Do not write from memory of the last few messages.
3. **Update the file** following the template:
   - **Protected sections** (Decisions, Tried and dropped, User notes and pitfalls): existing points stay **word for word**, new ones go at the end of the section. Move an outdated point to `## Archive` in the **archive file** `<thread>.archive.md` (next to the thread) with "— superseded: <by what>, <date>". Never shorten or rephrase old points.
   - **Summarized sections** (Goal, Current state, Evidence and numbers, Open questions, Next steps, Quick start): rewrite them to the current state.
   - **Log**: add one entry at the end (date, session id, 2–4 sentences). Do not touch the old ones. The thread file keeps the last 8 entries; move older ones word for word to the end of `## Log (older)` in the archive file.
   - **The archive file** only grows: append at the end of its sections; never change or remove anything in it. If it does not exist yet and there is something to move, create it from the template below. A thread from before this split (points in the thread's own `## Archive`, more than 8 log entries) gets slimmed the same way in this handoff.
   - **Save with edits** (Edit): append points at the end of protected sections, replace whole summarized sections. Do not rewrite an existing thread with Write: that is thousands of output tokens and an easy way to lose a point. Write only for a new thread or a new archive file.
   - Update `updated:` and `branch:`.
4. **Update the progress file**, when the repo has one (`docs/progress.md`, `docs/postep.md` or `PROGRESS.md`). Only the lines of the areas this thread covers, with Edit: one line per area in the right section (In progress, Blocked, Done recently; Polish: W toku, Zablokowane, Ostatnio zrobione), the state in a few words, the next step, and a link to the thread. Move a line between sections instead of copying it; keep the "done" section to the last few items and move older ones to the archive the file names. Set `updated:` (`zaktualizowano:`) to today. Never rewrite other areas' lines: other sessions own them. No progress file: skip this step (the repo setup creates one).
5. **Check** the file, against the previous version if the script made a copy:
   `python3 ${CLAUDE_SKILL_DIR}/scripts/check_handoff.py <file> --previous <copy from .previous/>`
   (without `--previous` for a new thread). The validator reads the archive file next to the thread and its previous copy itself. Fix every ERROR and check again; treat NOTEs about size and the archive as a task for this handoff.
6. **Finish** briefly (without summarizing the file). The first line of the answer is exactly `Kokpit · handoff saved: <thread>`: after this mark Kokpit in a parent session (when someone started this session) skips the note about this turn instead of commenting on it; if you end the turn with `wrap_up`, the recap starts with the mark too. Then: the path, the check result, the progress line if you changed one, step 1 of "Next steps" and the sentence: "The next message clears the conversation and resumes the thread (or `/clear`, then `/resume`)." Exception: when agents or commands of this session are still working in the background, say that clearing waits for their results (they would be lost), and append the results to the thread later. Do not start new work after a handoff.

## Checklist for the conversation

- What was the goal at the start, and did it change along the way?
- What is done **and verified** (test, render, screenshot, a run), and what is done but not verified?
- What is halfway (which files, in what state)?
- Which decisions did the **user** make (in their words), and which are Claude's proposals still waiting for an answer?
- What did we try and abandon, and why? (The most expensive knowledge to rebuild.)
- Which numbers came up: test results, measurements, sizes, timings, percentages?
- What did the user correct, what did they not want, what preferences do they have in this task?
- Which environment pitfalls came up (a dropped tool connection, paths, permissions, caches, imports)?
- Which files and documents must the next session read, and in what order?
- Which questions wait for the user's answer? What is blocking?

## Template (new thread)

```markdown
---
thread: <slug>
sessions: [${CLAUDE_SESSION_ID}]
updated: <YYYY-MM-DD HH:MM>
branch: <branch or none>
---

# <topic of the thread in a few words>

## Goal
<1–2 sentences: what this work should achieve and how to tell it is done.>

## Current state
- Done and verified: <what — verified how>
- Done, not verified: <what — what is missing to verify it>
- In progress: <file/place — the state it was left in>
- Repository: <branch, how many files changed, whether anything is committed>

## Decisions
- User (<date>): <decision> — "<their words, if any>"
- Claude's proposal, waiting for an answer (<date>): <proposal>

## Tried and dropped
- <approach> → <what happened> → <why it was dropped>

## User notes and pitfalls
- <preference, correction, something they do not want>
- <environment pitfall and how to get around it>

## Evidence and numbers
- <tests x/y, measurements, values before → after>

## Open questions
- <question for the user or a blocker> (or "none")

## Next steps
1. <the first concrete action, doable right away>
2. <...>

## Quick start
- Read: <file/document> (why)
- Run: `<command>` (what should come out)
- Useful skills/tools: <...>

## Log
- <YYYY-MM-DD HH:MM> · <session id> — <2–4 sentences: what was done in this stretch>

## Archive
- none (outdated points and older log entries go to `<slug>.archive.md`)
```

## Template (archive file `<slug>.archive.md`)

```markdown
# Archive of thread <slug>

Points and entries moved from `<slug>.md`, word for word. Append only; `/resume` reads this file only when something is missing.

## Archive
- <point of a protected section> — superseded: <by what>, <date>

## Log (older)
- <the oldest log entry, word for word>
```

## Rules

- **Do not make things up.** Mark what you do not know for sure as "[unverified]". A handoff with plausible-sounding guesses is worse than no handoff.
- **Where a decision came from.** Your proposal is not the user's decision, even if they answered "ok" to the whole list: record what they actually agreed to. When they approve a proposal, add a new "User (<date>): …" point and move the old one to the archive.
- **Point, do not copy.** If something is in a document, file or commit, give the path or name instead of copying it. Lasting project knowledge belongs in the project's documents anyway; the thread points to it.
- **Specifics instead of adjectives.** "test_terrain 244/244" instead of "tests pass"; "path X" instead of "this file".
- **Keep the summarized sections short** (about 1000 words in total). Protected sections may grow, that is their job; keep the thread file under ~20 KB (it is read in full at every `/resume`) and let the archive carry the rest.
- **No secrets.** Mask keys, tokens, passwords and personal data (`sk-…XXXX`) or leave them out.
- Write user-facing text in the language of the conversation; the thread's language and headings follow the "Language" section below.
