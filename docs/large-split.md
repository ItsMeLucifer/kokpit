# Large split: a procedure

Read when you split work into 3 or more subagents, or into parts that share files or an interface. Based on ideas from Nous Research's advanced-delegation plugin for Hermes. The main conversation (you) owns the plan, the contract, integration and the final word; subagents own their parts.

## 1. Contract first

Before any subagent starts, write down what the parts share: types and data shapes, function signatures, file layout, file formats, names, events, endpoints. Keep it in one place: a short contract file next to the work, or a section of the plan. Every brief points to it. A subagent that needs the contract changed stops and reports; it does not change the contract itself.

## 2. One owner per file

Each file a wave touches has exactly one owner. Shared files (registries, indexes, routers, config, a changelog, scene trees that several parts add to) belong to one task or are left for the integration step. Two subagents never edit the same file in one wave.

## 3. Gap check before dispatch

Give the plan and the contract to the strongest model available, read-only, with one question: what is missing or will collide? Look for tasks nobody owns, files with two owners, criteria that cannot be checked, parts that depend on a decision not yet made, and work that should be one task, not two. Fix the plan, then dispatch.

## 4. Waves

Order the tasks by dependency. Tasks within a wave run in parallel; the next wave starts only after you have checked the results of this one (a diff, a test, the file opened). A result that breaks the contract is fixed before the next wave builds on it.

## 5. Briefs

Each brief is self-contained: the goal, the contract, the files it owns (and that it changes nothing else), acceptance criteria with the check to run, prohibitions (no commits, no edits to skills, rules or CLAUDE.md), "do not ask, decide and explain", and a report that ends with "Decisions for the parent to record". Model and effort follow the rubric and the delegation log in Kokpit's note.

## 6. Integration

After the last wave, one task wires the parts together and runs the whole check (the full test suite, a build, the app driven as a user). Tests passing on both sides of an interface do not prove the sides fit. Do it yourself, or give it to one subagent that owns the shared files.

## 7. Final review

The strongest model available reviews the whole diff against the contract and the acceptance criteria. It gets the diff and the criteria, not the subagents' reports or your conclusions: authors do not sign off their own work.

## 8. Record

Record every subagent's outcome with `mcp__kokpit__subagent_result` (cause "model" only when it lacked the capability). Carry the decisions from the reports into the decision register or the thread. If the work stops mid-split, the handoff names the wave reached and the tasks still open; Kokpit keeps the briefs of background agents it pauses for a clear and starts them again after the resume.
