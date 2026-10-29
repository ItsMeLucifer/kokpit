---
name: grill
description: Take apart a plan or idea in rounds of questions with recommended answers until every branch of the decision tree is settled; the answers go into the decision register. Use when the user wants to stress-test a plan before work starts, or says "grill me on this".
argument-hint: "[plan, idea or document path]"
---

# Grill

Based on `grilling` from mattpocock/skills (MIT).

Write all questions and summaries in the language of the conversation.

Topic: $ARGUMENTS

Interrogate until you reach a shared understanding. Map the topic as a **decision tree**: each decision branches into the decisions that depend on it.

## Rounds

The **frontier** is all decisions whose premises are already settled - the questions you can ask *now* without guessing the answers to others. Ask the whole frontier in one round, numbered, with a recommendation on every question:

```
❓ **Q1 - <title>**: <question, with options if there are any>

➡️ <recommended answer and a one-sentence reason>
```

Phrase questions so that "yes" accepts the recommendation - the user can reply "1 yes, 2 yes, 3: I prefer B". A question that depends on another one still open in this round goes to the next round.

After the answers, recompute the frontier and ask the next round.

## Facts are your job

When a question needs a fact from the repo, the data or the documents, check it yourself (a subagent, a read, a short measurement) and do not ask the user for anything you can find out. Do not block the round: only questions that depend on a check in progress wait. **Decisions** belong to the user - put each one to them.

## Ending

Done when the frontier is empty: every branch visited, nothing assumed silently. Then:

1. A short summary of the tree: decision -> answer.
2. Every decision made that changes the design of the project or its tooling goes into the decision register (Kokpit's `decisionsFile`, default `docs/decisions.md`) as an already-resolved entry, using the entry format from Kokpit's system-prompt note: the answer in the user's words, marked as not yet implemented. Questions the user knowingly left unanswered go in as open entries.
3. Do not start implementing until the user confirms the shared understanding.
