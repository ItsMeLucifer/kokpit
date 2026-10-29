---
name: grill-me
description: Interrogate a loose idea in rounds of questions until it can be accepted with a clear conscience. Writes no files; works in any repo or none, and outside code too. Good when the topic is outside the user's own stack.
argument-hint: "[idea, plan or technology]"
disable-model-invocation: true
---

# Grill me

Based on `grill-me` from mattpocock/skills (MIT). The same flow as `/grill`, but **stateless**: it writes nothing (no decision register, no documents). The result is a clearer idea in the user's head.

Write all questions and summaries in the language of the conversation.

Topic: $ARGUMENTS

## Rounds

Map the topic as a **decision tree**. The **frontier** is the decisions whose premises are already settled. Ask the whole frontier in one round, numbered, with a recommendation:

```
❓ **Q1 - <title>**: <question, with options>
💡 <only when the topic is outside the user's stack: 1-2 sentences on why this decision matters, ideally by analogy to something they know>
➡️ <recommended answer and a one-sentence reason>
```

"Yes" accepts the recommendation, so the user can reply "1 yes, 2 yes, 3: I prefer B". A question that depends on another one still open waits for the next round. After the answers, recompute the frontier.

## Outside your own technology

When the topic is outside the user's stack:
- Ask about the goal and constraints first (time, scale, whether it has to last or just has to work), not about technical details.
- Bring the hidden decisions that everyone in that technology makes "by default" (e.g. state management, build, deployment, licences, costs) to the surface as separate questions. They bite most often.
- Recommend the path typical for that technology, and say when a recommendation comes from fashion rather than necessity.
- Check facts yourself (documentation, a repo, a short measurement) instead of asking the user.

## Rules

- **The user drives the scope.** Accept pushback, "I don't know" and narrowing of the scope as complete answers.
- On "I don't know", propose how to find out: a check or `/prototype`. Do not guess for the user.
- **Questions that talk cannot settle** ("how should it look", "will it feel good to use"): stop grilling that branch and propose `/prototype`.
- When the topic is too big for one session (more than ~4 rounds in sight), propose splitting it into parts first.

## Ending

Done when the frontier is empty. Then give a concise tree: decision -> answer, plus a list of what was knowingly left open. Write nothing and implement nothing until the user asks. If they ask for it to be recorded, use the decision register (Kokpit's `decisionsFile`, default `docs/decisions.md`) with the entry format from Kokpit's system-prompt note, as in `/grill`.
