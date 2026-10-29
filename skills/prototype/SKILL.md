---
name: prototype
description: A quick throwaway prototype that answers one design question, either whether a rule or mechanic holds together (a simulation in a single HTML file with buttons) or how something should look (several radically different variants side by side). Use when the question cannot be settled on paper.
---

# Prototype

Based on `prototype` from mattpocock/skills (MIT). A prototype is **throwaway code that answers a question**. The question decides the shape.

Write all user-facing text, including the labels inside the prototype, in the language of the conversation.

## Pick a branch

- **"Does this rule or mechanic hold together?"** (business rules, a state machine, pricing or economy, a new status, a contract between parts) -> **logic**.
- **"How should this look?"** (a card, a panel, a badge, a screen) -> **look**.

If it is unclear and the user is not around, pick the branch that fits the code next to it and write the assumption at the top of the prototype.

## Logic: one HTML file

1. At the top of the page, visibly: the question this prototype settles (one paragraph).
2. The logic in a single `<script>` as a pure module - a reducer `(state, action) => state`, a state machine, or a set of pure functions - with no DOM inside, so it can be ported 1:1 into the real codebase once the question is settled.
3. The page: a title; the **current state** as a readable panel (labelled fields, what just changed); **free-form buttons**, one action per button; **scenarios** in tabs, each resetting the state and walking through by buttons: the typical path, a hard edge case, an attempt at something that should be disallowed. For random mechanics: a seed field and a "run 1000 times" button with the distribution of outcomes - numbers, not impressions.
4. Use the domain's own language on labels, not variable names. No frameworks, everything in one file, opens with a double-click.

## Look: variants side by side

Several **radically** different variants (not shades of one), switched by a single parameter - an environment variable or flag read by the preview entry point, or in HTML a URL parameter and a switcher bar at the bottom. One screenshot per variant at the real target resolution, placed side by side so they can be compared at once.

## Rules for both branches

- Marked as a prototype in the name, in a scratch directory, or next to the code it concerns - never on paths the real application loads.
- Runs with one command or a double-click.
- No persistent state, no tests, no error handling beyond what is needed to run.
- Once the question is settled: record the decision in the decision register (Kokpit's `decisionsFile`, default `docs/decisions.md`, using the entry format from Kokpit's system-prompt note), or straight into the code if the user made the call. The prototype itself stays as a side source (a scratch directory or a `prototype/<name>` branch), not on the main branch.
