# Kokpit

**A Claude Code plugin for long, multi-session work.** It puts a status band above the prompt, replaces compaction with handoffs to thread files that carry on across sessions, keeps a decision register, runs long jobs in the background, routes subagent models and effort to the task, and sets up repositories with a lightweight, enforced agent harness.

*Kokpit* is Polish for "cockpit".

```
Context ████████░░ 78% 156k/200k  ·  5h ███░░░░░░░ 31% →14:20  ·  Week █░░░░░░░░░ 13% →Fri 09:00  ·  Task ████░░░░░░ 38% 1/4 — Scene
⚑ Context 156k: handoff after the task is finished.   [1 Now]   [2 Later]
```

Kokpit is a mod for Claude Code (the terminal and the **Code** tab of the desktop app, 2.1.287 or later). In claude.ai chat and cloud sessions mods do not draw; only the skills work there.

## Why

Most of what decides whether an agent does good work is outside the model: the harness. Kokpit is the harness I built for my own projects, organised around the five subsystems a harness needs:

| Subsystem | What Kokpit provides |
| --- | --- |
| **Instructions** | the repo standard: a short `CLAUDE.md` map, org-rules split into a shared core and a project part, area rules loaded lazily by `paths:`, a startup token budget |
| **Tools** | least-privilege permission rules generated from the project's "Protected" list; background jobs; a local model for cheap, verifiable work |
| **Environment** | the stack, pinned versions and first-run commands recorded in the project file; a machine setup script |
| **State** | a progress file with one line per area, updated at every handoff; handoff threads that grow across sessions instead of being summarised away; a decision register |
| **Feedback** | verification commands in the project file, `check_docs.py` as a hook and in CI, background test runs that report back, a rule that high-stakes work is checked by someone other than its author |

Two more ideas run through it: **enforce, don't instruct** (a rule a hook or a permission enforces costs no tokens and cannot be ignored), and **measure** (Economy records every request's tokens and estimates what dynamic effort and model routing actually saved).

## Features

### The band

Context fill, the 5-hour and weekly limits (with reset times) and progress of the current task list. Progress comes from Claude's task list (`TaskCreate`/`TaskUpdate`, the older `TodoWrite`, or the desktop app's own list): completed tasks plus half for the one in progress. To make Claude keep a list, Kokpit adds one sentence to the system prompt (`taskNudge`).

### Handoff instead of `/compact`

**When.** Two token thresholds. The **soft** one (150k by default, never later than 75% of the window) starts a handoff by itself, but only after a finished task. The **hard** one (soft + 100k by default, never beyond 85%) starts it at the end of the next turn even mid-work. Modes:

| Mode | After the threshold |
| --- | --- |
| `break` (default) | a handoff starts at the end of a turn when the task is finished: the whole list checked off and the turn does not end with a question; from the hard threshold, at the end of the next turn |
| `button` | only a **Handoff** button in the band |
| `auto` | a handoff starts at the end of the first turn after the threshold that does not end with a question |

At most one automatic handoff per conversation, so background work that fills the context does not trigger more. **Now** and **Later** (snoozes by 30k tokens) are always available.

**Where.** One file per **thread of work**, not per chat: `.claude/handoffs/<thread>.md`, carried across all the sessions of a topic. The frontmatter's `sessions:` lists the chats that wrote to it.

**Why nothing gets lost.**
- **Decisions**, **Tried and dropped** and **User notes and pitfalls** only grow: old points stay word for word, outdated ones move to the archive with a note on what superseded them.
- The archive and log entries older than the last 8 live in `<thread>.archive.md` (append only), so the thread file, read in full at every `/resume`, stays small.
- Before saving, a script copies the previous version, and a validator compares them: a protected point that disappeared without a trace is an error to fix. Above 20 KB the validator suggests slimming.
- Only the current sections are rewritten: Goal, Current state, Evidence and numbers, Open questions, Next steps, Quick start.

**What happens next, without clicking.** After the save nothing is cleared: you can read the last answers. When you write something, Kokpit holds the message, runs `/clear`, starts `/resume` for the thread in the new session and sends your message there, together with the last two answers as hidden context, so "yes" or "do point 2" still lands. Commands, messages with images and messages while background work runs pass through normally. If the conversation moved on after the save, Kokpit first refreshes the thread and only then clears. In plan mode the handoff waits until plan mode ends. While agents, Kokpit jobs or background commands of the session still run, clearing waits for their results.

As a safety net, a native auto-compact gets an instruction to carry decisions, rejected approaches and the user's remarks over verbatim and to point to the thread file.

### Decision register

One file for decisions waiting for you (`docs/decisions.md` by default). Claude gets a rule in the system prompt: a decision it made on your behalf, or a question it leaves you, becomes a `D-NNN` entry instead of "to be confirmed" scattered across documents.

- **Decisions: N pending** in the band (key `9`) or `/decisions` opens the pane: **Accept**, **Reject** or **Change** (your version + Enter); for a question, **Answer**. The ruling is written to the file at once.
- **Apply to documents** asks Claude to carry the rulings into the source documents and mark them applied. It does not change program behaviour on its own: it lists what would change and asks.

### Background jobs

Long commands that do not block the turn, configured per project in `.claude/kokpit.json`:

```json
{
  "tests": "python3 tools/testing/run_tests.py",
  "jobs": {
    "bench": "godot --headless --path . --script res://bench/{1}.gd -- {rest}",
    "coverage": "npm run coverage"
  }
}
```

| Command | Runs |
| --- | --- |
| `/tests [args]` | the `tests` command with the arguments appended (or substituted for `{args}`) |
| `/job <name> [args]` | a named job (`{1}`…`{9}`, `{rest}` and `{args}` are filled in) |
| `/job <command>` | any shell command |

Progress shows in the band (`⧗ tests camp · 1:23 · 14/52 ✓ · 1 ✗`, with **Stop**). Test runners that print `PASS name` / `FAIL name` lines get live counts. Claude has a `background` tool for the same thing and a rule to use it for anything longer than about a minute; the result comes back as a message. A result never interrupts a question: if Claude ended its turn asking you something, the result waits in the band and goes along with your answer.

### Economy: model and effort matched to the task

Per-project settings (shared by all worktrees of the repo) in `/kokpit` → Economy. They take effect in a new conversation or after `/clear`, because changing the system prompt mid-conversation would re-read the whole conversation.

- **Split across subagents.** For a large task Claude splits the work and sets `model` and `effort` for every subagent from a rubric: Opus for design and unknown bugs, Sonnet for precisely described work, Haiku only in three narrow roles whose output is cheap to verify: **Explore**, **kokpit:reporter** (runs commands and reports output verbatim) and **kokpit:mechanic** (a pattern-driven change with a check, which stops instead of guessing). Both Kokpit agents end with `DONE` or `ABORTED: reason`. A Haiku request outside these roles becomes Sonnet; a failed tool call raises a subagent's effort one level.
- **Dynamic effort.** For every new request Claude rates the difficulty with the `effort_rating` tool, in parallel with its first tool call: simple → the floor (medium by default), medium → high, hard → the ceiling (xhigh by default, which may be above the session setting). A failed tool call raises it one level; plan mode stays at the ceiling. Only on models where an effort change keeps the prompt cache (Opus/Sonnet/Haiku 5.5, Fable 5.1).
- **Local model.** Optional: a model from `ollama list` gets a `local_model` tool for summaries, drafts and pattern-driven code changes (through opencode in a separate worktree, returned as a diff to review).
- **Stats.** Pick your plan (**Pro · Max x5 · Max x20**) and see the savings as a share of the weekly limit (a range), in API dollars, for dynamic effort and subagents separately. Tokens are measured for every request; two things are estimates: how much more thinking a step at the highest level would have produced (ranges, from raw tokens kept so the ranges can change), and the no-Economy scenario for subagents. The weekly share comes from a per-plan calibration: the measured cost of all requests against the rise of the weekly counter.

### Tools in this repo

`/tools` shows whether the graphify code graph fits the repo (≥ 60% of the code in languages it parses) with buttons to install or toggle it, and lets you hide account skills from the model per repo (`skillOverrides`), so they take no context while `/name` keeps working. Why graphify and the headroom proxy are optional: [docs/headroom-graphify.md](docs/headroom-graphify.md).

### Workshop skills

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, see `THIRD_PARTY.md`), keeping only the ones that add control or quality:

| Skill | When |
| --- | --- |
| `/diagnose` | a hard bug: first one command that fails red, then hypotheses with predictions, a regression test, cleanup |
| `/review [focus]` | before a commit: two agents in parallel, Standards and Specification; uncommitted changes by default |
| `/retro` | after a session: what to improve in the harness (instructions, tests, tools); proposals only |
| `/architecture [area]` | an HTML report of places where modules could be deepened, then a breakdown of the chosen one |
| `/research` | a question researched by a background agent from primary sources, saved with citations |
| `/prototype` | a question that paper cannot settle: a rule simulated in one HTML file, or design variants side by side |
| `/grill [topic]` | a plan taken apart in rounds of questions with recommendations; results go to the decision register |
| `/grill-me [topic]` | the same without writing files, in any repo; for a topic outside your stack it adds short "why it matters" notes |

### Setup and the repo standard

`/setup` checks this machine and the current project and proposes what to run; it changes nothing without your consent.

- `setup.sh machine` installs uv and the plugins from `plugins.txt`, merges a settings profile (`profile.json`) into `~/.claude/settings.json` (missing keys only; `--overwrite` replaces differing ones), and optionally graphify and headroom.
- `setup.sh project` handles `.gitignore`, the thread directory, the fixed per-session cost report and the repo standard.

The **repo standard** ([docs/repo-standard.md](docs/repo-standard.md)) is one method for three states: an empty repo gets a skeleton and an interview; a repo with Claude but without the standard gets a difference report and a step-by-step migration, each step with your consent, deleting nothing; a compliant repo gets a check and core updates. In short:

- `.claude/CLAUDE.md` (with `AGENTS.md` in the root as a link) imports the org-rules summary and the project file;
- org-rules are a shared core from Kokpit (`00-core-*`, updated by setup) plus the project file (`10-project.md`: owner, rules, stack and environment, verification commands, the **Protected** list);
- `tools/docs/check_docs.py` checks the manifest, the startup budget (6k tokens), dead `paths:` globs, directory hints, links, verification commands, the agent's memory, a progress file older than the threads, and rules whose `(until: …)` date has passed, and runs as a `PostToolUse` hook after every edit in `.claude/` and `docs/`;
- `tools/docs/lock_org_rules.sh` writes deny rules (editing org-rules, protected files) and ask rules (commit, push, branch switches, destructive git, paid MCP tools) to `~/.claude/settings.json`, and locks the rules with `chmod`. Only the owner removes the lock, from their own terminal.

In all three states setup runs a **harness audit** ([skills/setup/harness-audit.md](skills/setup/harness-audit.md)). Whatever is not in the repo does not exist for an agent, so the audit asks what a brand-new session would have to guess:

- `standard.py audit` collects the evidence for fourteen questions: the fresh session test (what is this system, how is it organised, how do I run it, how do I verify it, where are we now), plus whether the entry is a short router, area knowledge next to the code, whether every rule has a reason, knowledge that lives outside the repo, protected things, pinned versions, automatic feedback, stale knowledge, and what a unit of work is;
- a separate subagent takes the fresh session test using only the repo, so the setup is not graded by its own author; every guess it has to make counts as a gap;
- the interview goes on until every gap is written down or the owner rules it out. Each answer goes to its one place (org-rules, an area rule, the map, the wiki, the decision register), and the owner's personal way of working goes to agent memory. Answers the script cannot confirm are recorded with a date and come back after 180 days;
- at the end the test runs again, and setup reports before and after.

Why `CLAUDE.md` and not only `AGENTS.md`: since Claude Code 2.1.277 `AGENTS.md` is read only as a fallback when a folder has no `CLAUDE.md` (and not on every provider), and the `@` imports the standard relies on are a Claude Code feature. A link gives other agents the same file.

## Installation

```
claude plugin marketplace add ItsMeLucifer/kokpit
claude plugin install kokpit@kokpit
```

Update with `claude plugin update kokpit@kokpit`. To work on Kokpit itself, add the cloned folder as the marketplace instead (`claude plugin marketplace add ~/path/to/kokpit`); after a change `/reload-plugins` is enough. On a new machine, `./install.sh` from a clone runs the machine setup.

Check in a session: `/plugin` shows `1 mod active · kokpit`. In each repo add `.claude/handoffs/.previous/` and `.claude/kokpit/` to `.gitignore` (`/setup project` does it); commit the threads and the decision register.

## Configuration

`/plugin configure kokpit@kokpit` in a terminal, or `/config` → Kokpit:

| Option | Default | Meaning |
| --- | --- | --- |
| `handoffMode` | `break` | `break`, `button` or `auto` (see Handoff) |
| `handoffTokens` | 150000 | the soft threshold in context tokens (never later than 75% of the window) |
| `handoffHardTokens` | 0 | the hard threshold; 0 = soft + 100,000 (never beyond 85%) |
| `handoffClear` | `message` | `message`: your next message after a save clears and resumes; `button`: only "Clear and resume" |
| `taskNudge` | true | ask Claude to keep a task list so the band can show progress |
| `decisionsFile` | empty | the decision register; empty = `docs/decisions.md` (or an existing `docs/decyzje.md`) |
| `language` | `en` | language of new handoff threads, register entries and repo-standard templates (`en` or `pl`); existing files keep theirs, the interface is English |

Per project: Economy in `/kokpit`, background jobs in `.claude/kokpit.json`.

## Commands

| Command | |
| --- | --- |
| `/kokpit` | the panel: Economy, Stats, Handoff & tools |
| `/handoff [focus]` | append this session to its thread (or start a new one) and validate the file |
| `/resume [thread]` | pick a thread (the newest by default), pin the session to it, show the commits since the last save, start step 1 |
| `/decisions` | the decision register pane |
| `/tests [args]`, `/job <name or command>` | background jobs |
| `/tools` | graphify and skill visibility for this repo |
| `/previous` | Claude's last answers from before the conversation was cleared |
| `/setup [machine \| project]` | machine and project setup, the repo standard |

Writing and editing `.claude/handoffs/*.md` is approved automatically (only `.md` files directly in that directory of the project).

## Development

```
claude plugin test .                               # mod tests (123)
python3 skills/setup/scripts/test_standard.py      # repo-standard scripts
claude plugin validate .
```

Layout: `hooks/register.tsx` wires everything to the engine; `hooks/economy.ts`, `hooks/decisions.ts`, `hooks/background.ts` and `hooks/tools.ts` hold pure, tested logic; `skills/` holds the skills and their scripts; `skills/setup/standard/` holds the repo-standard templates (directories starting with a dot are stored as `dot-…`).

Settings and stats written by versions before 0.10 (Polish field names and option values) are read and migrated automatically.

## License

MIT, see [LICENSE](LICENSE). The workshop skills are adapted from mattpocock/skills under the MIT license (`THIRD_PARTY.md`).
