# Harness audit: what a fresh agent session needs to know

Read by the `setup` skill for `project` (paths A, B and C). An agent can see only three things: the prompt, the files in the repo and the output of its tools. Whatever is not in the repo does not exist for it, and every new session has to guess it again. The audit finds those blank spots, asks the Owner about each one until it is filled or ruled out, and writes the answers where the next session will find them.

Evidence comes from `S audit` (`setup.sh standard audit <project>`). It reports what the repo shows; it cannot know what the Owner knows. Its marks: ✓ covered, ~ partial, ✗ missing, ? only the Owner can say, – not applicable.

## The questions

Fourteen items. The first five are the fresh session test: a new session with only the repo must answer them without asking a person.

| Item | Question | Covered when | The answer goes to |
|---|---|---|---|
| `what` | What is this system? | the entry says in a sentence or two what the project is and who it is for | the description in `.claude/CLAUDE.md` |
| `layout` | How is it organized? | every top-level directory is on the map, with a pointer to its area rule or wiki page | the "Where things are" map in `.claude/CLAUDE.md` |
| `run` | How do I run it? | the first-run and run commands are written down and work on a clean checkout | "Stack and environment" in the project file |
| `verify` | How do I verify it? | fixed commands for tests, lint and build, and every path in them exists | "Verification" in the project file; `tests` in `.claude/kokpit.json` |
| `now` | Where are we now? | the progress file has a line for every active area, newer than the threads | `docs/progress.md` (one line per area, linking its thread or detail page); open choices in the decision register |
| `entry` | Is the entry a short router? | the entry with its imports stays under 200 lines and the startup budget: overview, commands, hard constraints, pointers; at most 8 lasting rules | `.claude/CLAUDE.md` and the project summary; the rest to area rules and the wiki |
| `near-code` | Is area knowledge next to the code? | each large area has its constraints where the agent meets the code | `.claude/rules/<area>.md` with `paths:` (loaded only when working there) |
| `rules` | Does every rule have a reason, and do none contradict? | each lasting and area rule says why it exists, temporary ones end with `(until: …)`, no two rules disagree, and none could go without changing a decision | the rule itself; removals and conflicts as register entries |
| `outside` | What knowledge lives outside the repo? | the Owner has gone through chats, tickets, wiki pages and "things everyone knows", and what matters is written down | wherever its kind belongs (table below) |
| `protected` | What must the agent not touch or pay for? | local data, manual work, generators and paid tools are listed | "Protected" in the project file, enforced by the lock script |
| `pins` | Are tool and runtime versions pinned? | versions are in a pin or lock file, and the project file names them | the pin file itself; versions in "Stack and environment" |
| `feedback` | Does the feedback run without being asked? | `check_docs.py` runs as a hook, and the checks run in CI | the hook (`S hook`); a CI workflow (GitHub module) |
| `decay` | Is the written knowledge still true? | `check_docs.py` reports nothing, and the Owner confirms that nothing written contradicts how things work now | fixes in place; outdated pages to the archive |
| `work-units` | What is a unit of work, and when is it done? | it is clear what one change includes, which state counts as green, and how parallel agents stay apart | lasting rules in the project summary; the core already covers commits, branches and agents |

The last items come from treating agent state like a database transaction: a change is committed whole and verified or not at all (atomicity), "green" is a command, not a feeling (consistency), parallel agents do not write the same file (isolation), and what must outlive the session is in tracked files, not in the conversation (durability).

## Procedure

1. **Evidence.** Run `S audit`. For every item that is not ✓, read the files it names before asking anything, so each question comes with a suggestion taken from the code (a command from `package.json`, a directory list, a version from a lock file).
2. **Fresh session test, by a separate agent.** The author of the setup does not grade it. Start one subagent (general-purpose, not Explore, so it loads `CLAUDE.md` like a real session) with this brief, and nothing about what you already found:
   > Using only this repository (files and read-only commands; change nothing, ask nobody), answer: 1. What is this system? 2. How is it organized? 3. How do I run it? 4. How do I verify a change? 5. Where is the work now: what is done, in progress, blocked? For each: the answer in at most three sentences, the files you used, and what you had to guess. End with the information you looked for and could not find.

   Every guess and every "could not find" is a gap, even where `S audit` shows ✓. Keep the report: it is the "before".
3. **Interview until nothing is open.** Go through the gaps in the table's order. One topic at a time, at most three related questions in one turn, each with a concrete suggestion the Owner can accept or correct; use `AskUserQuestion` when the options are known. Ask in particular:
   - `outside`: "Which decisions about this project live outside the repo: in chats, tickets, a wiki, someone's head? Which of them would change how an agent writes code here?" Ask for each one what it is and why, not the whole history.
   - `decay`: "Is anything written here no longer true?" Name the pages and rules most likely to be stale (the oldest, those about code that changed most).
   - `now`: "Which areas are in progress, blocked, or recently done?" Seed the progress file with one line per area, linked to its thread or page. Status notes kept elsewhere (a local file, a dedicated skill, a chat) become the detail page a line links to.
   - `rules`: go through the lasting rules and the area rules with the Owner: why each exists (write the reason next to it), whether it is temporary (add `(until: …)`), which pairs contradict, and which could go without changing any decision. Every rule added while instructions bloat makes the important ones harder to see; a removal is as good a result as an addition.
   - `work-units`: "What does one change include (code, tests, docs)? Which command must be green before it counts as done? Do several agents ever work here at once?"
   An item is closed when its answer is written down (step 4) or the Owner says it does not apply; record that: `S audit --record <item> n/a "<reason>"`. For `outside`, `decay` and `work-units`, which the script cannot confirm, record the answer: `S audit --record <item> answered "<one line>"` (it counts for 180 days, then the question comes back). The Owner may stop at any time: then list what is still open and stop asking.
4. **Write each answer to its one owner.** Show the text before writing it; org-rules changes follow the unlock procedure.

   | The answer is | It goes to |
   |---|---|
   | a lasting rule for the whole project | the project summary in the project file (3–8 rules; more go to `11-…` files with a "Read when" line) |
   | a constraint of one area or module | `.claude/rules/<area>.md` with `paths:` |
   | how to run, versions | "Stack and environment" |
   | how to verify | "Verification" and `.claude/kokpit.json` |
   | something not to touch or pay for | "Protected" |
   | where something is | the map in `.claude/CLAUDE.md` |
   | how something works and why | a wiki page in `docs/` and its line in `docs/README.md` |
   | a choice not settled yet | the decision register |
   | where an area stands | its line in the progress file; the details in its handoff thread or a detail page |
   | how the Owner likes to work with agents (how to ask, how much to explain, review style), or a lesson about working with them | agent memory: the repo is the record of the project, memory is the record of the person |

   Every rule you write says why it exists, and a temporary one ends with `(until: YYYY-MM-DD)` or `(until: <condition>)`. Hard constraints stay at the top of the project summary, not in the middle of a long page.

   Project knowledge never goes only to memory: memory is not in the repo, so other sessions, worktrees, tools and people do not see it. Memory holds no copies of rules either; it may point to them.
5. **Check.** `python3 tools/docs/check_docs.py` (zero errors, startup budget kept), then `S audit` again, then the fresh session test again with a new subagent and the same brief. Report the "before" and "after" in a few lines: covered items, and the guesses that disappeared or remain.

## Proportion

Minimal but complete: every question needs an answer, but a rule that would not change any decision of the agent does not belong in the repo. Prefer one line next to the code over a page in the wiki, and a command over a description of a command.
