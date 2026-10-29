---
name: resume
description: Resumes work from a handoff thread (.claude/handoffs/<thread>.md) and pins the current session to it. Use at the start of a new session when the user says "resume", "continue", "where did we stop", or when Kokpit starts it from the button.
argument-hint: "[thread, path or session id; empty = the newest thread]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/find.sh *) Read
---

# Resuming from a thread

The requested thread (empty = the newest): $ARGUMENTS

## What is on disk

!`${CLAUDE_SKILL_DIR}/scripts/find.sh ${CLAUDE_PROJECT_DIR} ${CLAUDE_SESSION_ID} $ARGUMENTS`

The script has already pinned this session to the chosen thread (`sessions:`), so `/handoff` in this session appends to the same file.

## Steps

1. **Read the thread file in full** (the thread itself, not its archive). Most important: Next steps, Decisions, Tried and dropped, User notes and pitfalls. Open the archive file (`<thread>.archive.md`, or `.archiwum.md` for a Polish thread) only when something is missing or the plan touches a matter the thread points to the archive for.
2. **Check that it is current.** Compare "Current state" with what the script showed (commits and changes since `updated`). If something drifted apart, say what in one sentence.
3. **Read the files from "Quick start"** in the given order. Do not read the whole repository up front.
4. **Report briefly** (up to 6 lines): thread, goal, state in one sentence, open questions for the user (if any), step 1.
5. **Act.** If step 1 is unambiguous, reversible and not waiting for the user, start it right away in the same answer. If it waits for a decision, ask one question and stop.
   **Exception: the script printed "AFTER CLEAR":** Kokpit cleared the conversation because the user wrote something, and their message comes right after this answer (with the previous conversation's latest answers in context). Report in 1–2 lines, the first being exactly `Kokpit · resumed thread: <thread>` (after this mark a parent session skips the note about this turn), and do not start step 1 or ask questions: that message gives the direction.

## Rules

- "User (…)" decisions are closed: do not reopen them without a new reason.
- "Tried and dropped" is a list of things you do **not** repeat.
- "Claude's proposal, waiting for an answer" are open matters, not agreements.
- A Polish thread uses the same structure under Polish headings (Cel, Stan teraz, Decyzje, Próbowaliśmy i odpadło, Uwagi użytkownika i pułapki, Następne kroki, Szybki start, Dziennik).
- Report in the language of the conversation.
