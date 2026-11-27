---
status: org-rules
version: 1
core: 0.13.0
owner: Owner (defined in 10-project.md)
---

# 00 · Code: causes, comments, tests, documents

Read when: you write or review code, a test or a document. Kokpit checks part of this after every edit (the `checks` section of .claude/kokpit.json); the rest is on you.

## Fix causes

1. A problem in our own code is fixed, not explained. No comment that excuses a workaround ("for now", "temporary", "hack", a TODO nobody owns) and no checker suppression (`eslint-disable`, `@ts-ignore`, `# noqa`, `@warning_ignore`, and the like) for a problem the code could avoid.
2. A suppression stays only when the rule is wrong for this case or the cause is outside our code, and its line says which in a few words.
3. What you could not fix is named in your report; a choice the Owner must make goes to the decision register. Neither goes into a comment.

## Comments

4. A comment says what the code cannot: a constraint from outside (an engine, a platform, a vendor, a protocol, data that older versions left behind), the contract of a public function or type when its name and signature do not say it, or a pointer that saves a search ("parsed by X", "keep in sync with Y").
5. No narration of what the next line does, no history of the change, no defence of our own design: history is in git, design decisions are in the register or the wiki.
6. A surprise in our own code is reshaped (a name, a type, an extracted function) until it needs no comment.

## Tests

7. A test checks behaviour through the public interface. Hold it against two imagined edits: break the behaviour and the test must fail; change only the internals and it must still pass.
8. A regression test for a bug is welcome. It asserts the behaviour the bug broke, with the input that broke it, not the line you changed. A test that only raises coverage does not count.

## Documents

9. A new markdown file appears only where the repo keeps documents (by default `docs/`, `.claude/` and README files). A summary of your own work goes into your report, not into a file.
10. A document describing a limitation of our own code is a bug to fix or a register entry, not a wiki page.

## Quality bar

11. The project file says whether the project, or an area of it, is a prototype or a product. A prototype skips boilerplate, layers and broad tests but keeps one check that runs it; a product gets the full verification. In both, the smallest change that solves the problem beats a general one.
