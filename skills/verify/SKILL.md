---
name: verify
description: Proves that a finished change works the way a user meets it, using the repo's feature map (docs/features/). A fresh subagent drives each affected feature and captures evidence; a feature missing from the map gets its page first. Run it when a feature is done, or when Kokpit offers it after the task list is complete.
argument-hint: "[feature names or paths; empty = the features the current change touches]"
disable-model-invocation: true
allowed-tools: Read Glob Grep Bash(git diff *) Bash(git status *) Bash(git log *)
---

# Verify: prove the change works for its user

What to verify (empty = the features the current change touches): $ARGUMENTS

The author of a change does not grade it. You coordinate: you pick the features, make sure each has a page, and hand each one to a fresh subagent that has not seen this conversation. You do not drive the app yourself and you do not soften a verdict.

## The feature map

`docs/features/README.md` (`docs/funkcje/README.md` in a Polish repo) is the index plus **Driving the app**: how to launch the app for verification and tell it is ready, a read-only doctor check, how to drive it (commands, selectors, scripts the repo already has), where evidence goes, and how to clean up. Each feature has its own page, `docs/features/<feature>.md`:

```markdown
---
paths: [src/inventory/**, scenes/inventory/*.tscn]
---
# <Feature>

<One sentence: what the user gets.>

## Sub-features
## How a user gets to it
## Driving it
<Steps with the exact commands from "Driving the app"; each step ends with the observable state it must reach.>
## What proves it works
<The end state a user would see, plus side effects (files, saved data, messages). A save message alone is not proof: read the result back.>
## Gotchas
```

`paths:` ties pages to code, so the changed files name the features to verify.

## Steps

1. **Scope.** With `$ARGUMENTS` empty: `git status --short` and `git diff --name-only` against the branch base, then match the changed files against each page's `paths:`. List the features and say which changed files no page covers.
2. **No map yet.** When `docs/features/README.md` is missing, stop and offer `/kokpit:setup project` (the harness audit, item `proof`) to create it. Without a way to drive the app, nothing here can prove anything, and a page of prose would only pretend to.
3. **A feature without a page.** Write its page before verifying: answer from the code and the change what the feature is, how a user reaches it, how to drive it with the commands in "Driving the app", and what end state proves it. Ask the user only what the code cannot tell. Add the page to the index.
4. **Hand each feature to a fresh subagent** (general-purpose, Sonnet with high effort unless the feature needs judgement about design, then Opus). One subagent per feature; features that share one running instance go to the same subagent in sequence. The brief, self-contained:
   > You verify one feature of this repo the way its user meets it. Read `docs/features/README.md` (Driving the app) and `docs/features/<feature>.md`. Launch the app as the README says, run the doctor check, then drive every step of the page through the user's path, never through internal setters or test-only shortcuts. After each step, observe the state it must reach. Save evidence (screenshots, transcripts, outputs, read-back data) under `.claude/kokpit/evidence/<feature>/<date>/`. Clean up what you started, keep the evidence. Do not change application code or the page. If a precondition is missing, the verdict is BLOCKED with the reason; never weaken a step to make it pass. Report: PASS, FAIL or BLOCKED; for each step what you did and what you observed; the evidence paths; anything on the page that turned out wrong (a Gotcha to add).
5. **Judge the reports**, not the subagents' tone: a PASS without evidence for each step is not a PASS. A FAIL goes back to the work with the observed state; you do not call the change done.
6. **Keep the map honest.** Add the Gotchas the subagents found to the pages, and fix steps that no longer match the app (show the edit). When the progress file exists, the line of a verified area gets the evidence path.
7. **Report** in the conversation's language: per feature PASS / FAIL / BLOCKED with one line of evidence, what no page covers, and what is still unverified.
