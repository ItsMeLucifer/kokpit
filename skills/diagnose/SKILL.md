---
name: diagnose
description: Diagnosis loop for hard bugs and performance regressions. Use when something is broken, throws, fails, behaves differently in one environment than another, or got slower, before you start guessing at the cause.
---

# Diagnose

A discipline for hard bugs. Skip a phase only with a stated reason.

Based on `diagnosing-bugs` from mattpocock/skills (MIT).

Write everything the user reads in the language of the conversation.

## Phase 1: a loop that goes red

**This is the whole skill.** With a tight loop (one command that goes *red* on *this* bug) the cause will turn up; without it, no amount of reading code helps. Put most of your effort here.

Ways to build it, roughly in this order:

1. **A test** at the right seam: run the project's own test command, narrowed to the relevant area (check the project's testing docs, if any, for how).
2. **A throwaway harness script** in a scratch directory: loads the input or fixture, replays the steps, checks the resulting state.
3. **A differential loop:** the same sequence of inputs through two implementations (or two environments, or the old and new version of the data), comparing state after each step.
4. **Capture and compare** for visual bugs: a script that renders or screenshots, then a pixel or structural diff against a known-good capture.
5. **A measuring script** for tools you cannot eyeball (a 3D editor, a design file, a build artifact): script it to report the specific number or property in question instead of looking at a view.
6. **Bisection:** when the bug appeared between two known states, run `git bisect run` with a command from items 1-5.
7. **A human in the loop** only as a last resort: when someone has to click through the app, prepare the exact list of steps and say what they should report back.

Tighten the loop: faster (a narrower test, skip unnecessary setup or import steps), sharper (assert the exact symptom, not just "it didn't crash"), deterministic (fixed seeds, pinned inputs, frozen time).

**Done when** you have **one command** that you have already run once (show the invocation and its output) and that: reproduces **the exact symptom the user reported**, gives the same verdict every time, takes seconds, and needs no human. If you catch yourself reading code and building theories before that command exists, come back here.

If you cannot build a loop: say so plainly, list what you tried, and ask for what is missing (a log, a screenshot, step-by-step instructions, the input file).

## Phase 2: reproduce and minimize

Make sure it is **this** bug and not a neighbouring one. Then cut the scenario (inputs, entities, configuration, frames) one element at a time, running the loop after each cut. Done when every remaining element is load-bearing.

## Phase 3: hypotheses

3-5 hypotheses in order of likelihood, each with a prediction: "If the cause is X, then changing Y will make the bug go away." Show the list to the user and start testing the first one right away; their knowledge may reshuffle the order, but you do not wait for it.

## Phase 4: probes

One variable at a time. Log lines carry a unique marker such as `[DIAG-xxxx]` so cleanup is a single grep. For performance problems: measure first (time, counts, a profiler), then bisect.

## Phase 5: fix and regression test

Write the regression test **before** the fix, but only at the right seam, one that reproduces the real pattern of the bug. Having no such seam is a finding in itself: record it (a candidate for `/architecture`). Order: test red, fix, test green, then the Phase 1 loop on the original scenario.

## Phase 6: cleanup

- [ ] the original scenario no longer reproduces the bug
- [ ] the regression test passes (or the missing seam is described)
- [ ] `grep -rn "DIAG-"` is empty
- [ ] harnesses and scratch scripts are deleted or live in a scratch directory outside the repo
- [ ] the summary says which hypothesis turned out to be true and why
