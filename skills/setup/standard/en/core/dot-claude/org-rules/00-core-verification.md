---
status: org-rules
version: 1
core: 0.11.0
owner: Owner (defined in 10-project.md)
---

# 00 · Verification and tests

Read when: you finish a task, write a test, or doubt that a change leaves the rest intact. This project's verification commands are in `10-project.md` (section "Verification"); CI status and anything that changes over time live in the wiki, not here.

## When work is done

1. The code has been **run**, not only written. You do not say "it works" without having seen the result.
2. **New logic has a test that executes it and checks the result**, not only that it does not crash. A test without an assertion on the result does not count as coverage.
3. A visual change has been **looked at** (a screenshot, the window, the generated file), not inferred from the code.
4. What you verified and what you did not (other systems, devices, behaviour in motion) is stated separately in the report.
5. You finish a change with the verification commands from `10-project.md`; when the project has a full check, it runs before you call the work done.

## Tests

6. A test fails when: the exit code is not 0, the output contains an error despite exit 0, or the time limit ran out.
7. Tests are deterministic: the same input gives the same result; a test does not depend on the clock, file order or state left by a previous test.
8. Tests do not touch the Owner's data (saves, settings, items on the "Protected" list); they use their own paths.
9. You do not "fix" a test by loosening its assertions. A timeout under load (many parallel sessions) is checked by running the test alone before you call it a regression.
10. The quality gate is CI, not a local hook. You skip git hooks only with the Owner's consent.
11. A measurement or test suite longer than about 2 minutes runs in the background. While it runs, you do not edit the files it reads.

## Reporting

12. Failures come with the test output; you do not hide them behind "most of them passed". Skipped steps are named.
