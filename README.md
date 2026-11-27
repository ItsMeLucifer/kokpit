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
| **Feedback** | silent checks after every edit (the project's linter on the changed lines, checker suppressions and workaround comments, new markdown outside the document places), verification commands in the project file, `check_docs.py` as a hook and in CI, background test runs that report back, `/kokpit:verify` proving a finished feature through a fresh agent |

Two more ideas run through it: **enforce, don't instruct** (a rule a hook or a permission enforces costs no tokens and cannot be ignored), and **measure** (Economy records every request's tokens and estimates what dynamic effort and model routing actually saved).

## Features

### The band

Context fill, the 5-hour and weekly limits (with reset times) and progress of the current task list. Progress comes from Claude's task list (`TaskCreate`/`TaskUpdate`, the older `TodoWrite`, or the desktop app's own list): completed tasks plus half for the one in progress. To make Claude keep a list, Kokpit adds one sentence to the system prompt (`taskNudge`).

### Handoff instead of `/compact`

**How much Kokpit does by itself.** One choice in `/kokpit` → Handoff & tools, for all projects:

| Level | What happens |
| --- | --- |
| **Manual** | Kokpit only suggests: from the clear threshold the band offers a **Handoff** button, and clearing is a button too |
| **Assisted** (default) | from the clear threshold a handoff starts by itself once the task is finished (the whole list checked off, the turn not ending with a question); from the critical threshold, at the end of the next turn even mid-work; your next message clears and resumes |
| **Automatic** | as Assisted, but Kokpit also clears and resumes by itself, waits for background work, and pauses it past the critical threshold (below) |

**When.** Two token thresholds, chosen next to the level: the **clear threshold** (150k by default, never later than 75% of the window) and the **critical threshold** (clear + 100k by default, never beyond 85%). Until you pick a level, the plugin settings `handoffMode` and `handoffClear` decide (they also offer `auto`: a handoff at the end of the first turn after the threshold that does not end with a question).

At most one automatic handoff per conversation, so background work that fills the context does not trigger more. **Now** and **Later** (snoozes by 30k tokens) are always available.

**Where.** One file per **thread of work**, not per chat: `.claude/handoffs/<thread>.md`, carried across all the sessions of a topic. The frontmatter's `sessions:` lists the chats that wrote to it. Threads have one home, the main checkout, also for sessions in a worktree: a gitignored folder copied into a new worktree would otherwise fork every thread. A thread left in a worktree copy by an older Kokpit moves home when it is resumed by name; a worktree copy newer than the home thread is reported for merging.

**Why nothing gets lost.**
- **Decisions**, **Tried and dropped** and **User notes and pitfalls** only grow: old points stay word for word, outdated ones move to the archive with a note on what superseded them.
- The archive and log entries older than the last 8 live in `<thread>.archive.md` (append only), so the thread file, read in full at every `/resume`, stays small.
- Before saving, a script copies the previous version, and a validator compares them: a protected point that disappeared without a trace is an error to fix. Above 20 KB the validator suggests slimming.
- Only the current sections are rewritten: Goal, Current state, Evidence and numbers, Open questions, Next steps, Quick start.

**What happens next, without clicking.** After the save nothing is cleared: you can read the last answers. When you write something, Kokpit holds the message, runs `/clear`, starts `/resume` for the thread in the new session and sends your message there, together with the last two answers as hidden context, so "yes" or "do point 2" still lands. Commands, messages with images and messages while background work runs pass through normally. If the conversation moved on after the save, Kokpit first refreshes the thread and only then clears. In plan mode the handoff waits until plan mode ends. While agents, Kokpit jobs or background commands of the session still run, clearing waits for their results (your message goes to this conversation), then refreshes the thread with them and clears.

**Clearing by itself.** On the **Automatic** level nothing waits for a message: once the thread is saved and nothing runs in the background, Kokpit clears and resumes. After a finished piece of work the new session only reports and waits for you; after a handoff cut mid-work it carries on. Past the **critical threshold** Kokpit stops waiting for background agents: it stops them, keeps each agent's brief and the files it changed in `.claude/kokpit/paused/<thread>.json`, clears, resumes, and the new session starts them again in the background with the original brief and a note to continue from their draft (Kokpit swaps a short marker for the brief, so this costs no tokens). Background commands that were stopped are listed for a re-run. The band also offers **Pause them and clear** while it waits.

**Lessons.** A handoff also looks for a procedure the user keeps asking for from scratch, a skill they corrected, or a mistake they had to point out twice, and adds at most three proposals to the decision register: a new skill, a change to a named skill, or a check (a linter rule or a `checks` pattern), in that order of preference: a check before a skill, a skill before a sentence. You accept or reject them in `/decisions`; nothing is written during the handoff.

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

- **Split across subagents.** For a large task Claude splits the work and sets `model` and `effort` for every subagent from a rubric: Opus for design and unknown bugs, Sonnet for precisely described work (on a Sonnet conversation subagents stay on Sonnet and Opus is only an advisor for a single hard question, because an Opus subagent costs twice the conversation's model), Haiku only in three narrow roles whose output is cheap to verify: **Explore**, **kokpit:reporter** (runs commands and reports output verbatim) and **kokpit:mechanic** (a pattern-driven change with a check, which stops instead of guessing). Both Kokpit agents end with `DONE` or `ABORTED: reason`. A Haiku request outside these roles becomes Sonnet; a failed tool call raises a subagent's effort one level.
- **Briefs and large splits.** Every brief names the files the subagent may change, forbids commits and edits to skills, rules and `CLAUDE.md`, and asks for a closing "Decisions for the parent to record" section. Before a split into 3 or more subagents, or into parts that share files or an interface, Claude reads [`docs/large-split.md`](docs/large-split.md): contract first, a gap check of the plan by the strongest model, waves with one owner per file, an integration step, a final review by the strongest model. Based on ideas from Nous Research's [advanced-delegation](https://github.com/NousResearch/hermes-official-plugins/tree/main/advanced-delegation) plugin for Hermes.
- **Delegation log.** After checking a subagent's work Claude records it with the `subagent_result` tool: the class of task, the model, and whether it passed first try, needed a fix or failed, with the cause. Only a failure on capability moves that class to a stronger model; a weak brief, missing context or a broken environment is fixed without one. After 3 first-try passes in a row Kokpit suggests one tier cheaper (never Haiku). The lessons go into the rubric at the start of the next conversation (not mid-conversation, to keep the prompt cache), and the classes show in `/kokpit` → Stats.
- **Dynamic effort.** For every new request Claude rates the difficulty with the `effort_rating` tool, in parallel with its first tool call: simple → the floor (medium by default), medium → high, hard → the ceiling (xhigh by default, which may be above the session setting). A failed tool call raises it one level; plan mode stays at the ceiling. Only on models where an effort change keeps the prompt cache (Opus/Sonnet/Haiku 5.5, Fable 5.1).
- **Local model.** Optional: a model from `ollama list` gets a `local_model` tool for summaries, drafts and pattern-driven code changes (through opencode in a separate worktree, returned as a diff to review).
- **Stats.** Pick your plan (**Pro · Max x5 · Max x20**) and see the savings as a share of the weekly limit (a range), in API dollars, for dynamic effort and subagents separately. Tokens are measured for every request; two things are estimates: how much more thinking a step at the highest level would have produced (ranges, from raw tokens kept so the ranges can change), and the no-Economy scenario for subagents. The weekly share comes from a per-plan calibration: the measured cost of all requests against the rise of the weekly counter.

### Checks after every edit

Kokpit looks at what each `Edit` or `Write` added, in the main conversation and in subagents, and says something only when there is a problem, so a clean edit costs no tokens:

- the project's linter runs on the edited file, and only problems on the changed lines are reported back to the agent;
- an added checker suppression (`eslint-disable`, `@ts-ignore`, `# noqa`, `@warning_ignore`, `//nolint` and others across languages) or a comment that reads like a workaround ("for now", "temporary", `TODO`) comes back with a request to fix the cause instead;
- a project's own forbidden patterns (`checks.patterns`) are reported the same way;
- a new markdown file outside the places the repo keeps documents asks the person first.

The rules are the project's, not Kokpit's: the `checks` section of `.claude/kokpit.json` names the linter per glob and the patterns, and setup fills it in from an interview about what goes wrong in this repo (a catalogue of linters by stack: [skills/setup/linters.md](skills/setup/linters.md)). `"checks": false` turns it all off for everyone; `/kokpit` → Quality switches it off for this project on this machine only.

### Proving a feature works

When a task list completes after code changed, the band offers **Verify**. `/kokpit:verify` matches the changed files to the pages of the repo's feature map (`docs/features/`, each page with `paths:`), writes a page for a feature that has none (what the user gets, how they reach it, the steps, what end state proves it), and hands each feature to a fresh subagent that drives the app as the map's "Driving the app" section says and saves evidence. The author of a change never grades it. The approach follows the feature maps of [pstack](https://github.com/cursor/plugins/tree/main/pstack).

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

Optional, from the same marketplace: `claude plugin install security-audit@kokpit` installs [Cloudflare's security audit skill](https://github.com/cloudflare/security-audit-skill) (MIT), pinned to a reviewed commit; the pin moves only with a Kokpit release.

### Setup and the repo standard

`/setup` checks this machine and the current project and proposes what to run; it changes nothing without your consent.

- `setup.sh machine` installs uv and the plugins from `plugins.txt`, merges a settings profile (`profile.json`) into `~/.claude/settings.json` (missing keys only; `--overwrite` replaces differing ones), and optionally graphify and headroom.
- `setup.sh project` handles `.gitignore`, the thread directory, the fixed per-session cost report and the repo standard.

The **repo standard** ([docs/repo-standard.md](docs/repo-standard.md)) is one method for three states: an empty repo gets a skeleton and an interview; a repo with Claude but without the standard gets a difference report and a step-by-step migration, each step with your consent, deleting nothing; a compliant repo gets a check and core updates. In short:

- `.claude/CLAUDE.md` (with `AGENTS.md` in the root as a link) imports the org-rules summary and the project file;
- org-rules are a shared core from Kokpit (`00-core-*`, updated by setup; `00-core-code.md` holds the rules on fixing causes, comments, tests and new documents) plus the project file (`10-project.md`: owner, rules, stack and environment, quality bar, verification commands, the **Protected** list);
- `tools/docs/check_docs.py` checks the manifest, the startup budget (6k tokens), dead `paths:` globs, directory hints, links, verification commands, the agent's memory, a progress file older than the threads, and rules whose `(until: …)` date has passed, and runs as a `PostToolUse` hook after every edit in `.claude/` and `docs/`;
- `tools/docs/lock_org_rules.sh` writes deny rules (editing org-rules, protected files) and ask rules (commit, push, branch switches, destructive git, paid MCP tools) to `~/.claude/settings.json`, and locks the rules with `chmod`. Only the owner removes the lock, from their own terminal.

In all three states setup runs a **harness audit** ([skills/setup/harness-audit.md](skills/setup/harness-audit.md)). Whatever is not in the repo does not exist for an agent, so the audit asks what a brand-new session would have to guess:

- `standard.py audit` collects the evidence for sixteen questions: the fresh session test (what is this system, how is it organised, how do I run it, how do I verify it, where are we now), plus whether the entry is a short router, area knowledge next to the code, whether every rule has a reason, knowledge that lives outside the repo, protected things, what guards the code against the mistakes agents make here (the linter and `checks`, prototype or product), whether an agent can drive the app and prove a feature works (the feature map), pinned versions, automatic feedback, stale knowledge, and what a unit of work is;
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
| `handoffMode` | `break` | `break`, `button` or `auto`; used until you pick a level in `/kokpit` |
| `handoffTokens` | 150000 | the clear threshold in context tokens (never later than 75% of the window); `/kokpit` overrides it |
| `handoffHardTokens` | 0 | the critical threshold; 0 = clear + 100,000 (never beyond 85%); `/kokpit` overrides it |
| `handoffClear` | `message` | `message`: your next message after a save clears and resumes; `button`: only "Clear and resume"; used until you pick a level in `/kokpit` |
| `taskNudge` | true | ask Claude to keep a task list so the band can show progress |
| `decisionsFile` | empty | the decision register; empty = `docs/decisions.md` (or an existing `docs/decyzje.md`) |
| `language` | `en` | language of new handoff threads, register entries and repo-standard templates (`en` or `pl`); existing files keep theirs, the interface is English |

Per project: Economy and Quality in `/kokpit`, background jobs and checks in `.claude/kokpit.json`. For all projects: clearing and both thresholds in `/kokpit` → Handoff & tools.

## Commands

| Command | |
| --- | --- |
| `/kokpit` | the panel: Economy, Stats, Quality (switches for checks, verification and lessons per project), Handoff & tools; `? Help` shows the explanations |
| `/handoff [focus]` | append this session to its thread (or start a new one) and validate the file |
| `/resume [thread]` | pick a thread (the newest by default), pin the session to it, show the commits since the last save, start step 1 |
| `/decisions` | the decision register pane |
| `/tests [args]`, `/job <name or command>` | background jobs |
| `/tools` | graphify and skill visibility for this repo |
| `/previous` | Claude's last answers from before the conversation was cleared |
| `/setup [machine \| project]` | machine and project setup, the repo standard |
| `/verify [features]` | prove the change works through the feature map and fresh agents |
| `/setup-linter [stack or mistakes]` | only a linter: from the recurring mistakes to a config, a baseline and, if you want, a run after every edit |
| `/setup-testing [what to test]` | only manual testing by an agent: a proven recipe to launch, drive and observe the app ("Driving the app" in the feature map) |

Writing and editing `.claude/handoffs/*.md` is approved automatically (only `.md` files directly in that directory of the main checkout or of the session's worktree).

## Development

```
claude plugin test .                               # mod tests
python3 skills/setup/scripts/test_standard.py      # repo-standard scripts
claude plugin validate .
```

Layout: `hooks/register.tsx` wires everything to the engine; `hooks/economy.ts`, `hooks/decisions.ts`, `hooks/background.ts`, `hooks/checks.ts` and `hooks/tools.ts` hold pure, tested logic; `skills/` holds the skills and their scripts; `skills/setup/standard/` holds the repo-standard templates (directories starting with a dot are stored as `dot-…`).

Settings and stats written by versions before 0.10 (Polish field names and option values) are read and migrated automatically.

## License

MIT, see [LICENSE](LICENSE). The workshop skills are adapted from mattpocock/skills under the MIT license (`THIRD_PARTY.md`).
