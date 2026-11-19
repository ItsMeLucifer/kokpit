---
name: setup-linter
description: Sets up a linter for the current repo on its own, without the rest of /kokpit:setup. Starts from the mistakes that keep coming back, proposes a linter that fits the stack, writes its config, measures the baseline, and asks whether Kokpit should run it on every edit.
argument-hint: "[the stack or the mistakes to catch; empty = ask]"
disable-model-invocation: true
allowed-tools: Read Glob Grep Bash(git ls-files *) Bash(git status *)
---

# Set up a linter

What the user asked for (empty = start with the questions below): $ARGUMENTS

Only the linter. Do not touch org-rules, the repo standard, the feature map or anything else `/kokpit:setup` does. Install nothing, add no dependency and change no file without the user's consent; show each file before writing it. Talk in the language of the conversation.

## Steps

1. **What is there.** From the repo, not from the user: the languages by tracked files (`git ls-files`), the version files and lock files, and every linter or formatter already configured (for example `eslint.config.*`, `biome.json`, `ruff.toml` or `[tool.ruff]` in `pyproject.toml`, `analysis_options.yaml`, `gdlintrc`, `.golangci.yml`, `.swiftlint.yml`, `.editorconfig`), plus where the repo runs checks (package scripts, a Makefile, CI workflows). Report it in a few lines.
2. **What goes wrong.** Ask one question: which mistakes keep coming back in this code, from agents or people (unused code, a forbidden import between layers, swallowed errors, magic numbers, giant functions, a deprecated helper…). Accept "nothing specific": then aim for a sensible default rule set and nothing more.
3. **Propose.** Read `${CLAUDE_SKILL_DIR}/../setup/linters.md`. Prefer the linter the repo already has; otherwise propose the one from the catalogue that fits the stack, with its install command (pinned the way the project pins its tools). For each named mistake, the cheapest check that catches it, in the catalogue's order: an existing rule of the linter, a forbidden pattern for Kokpit, a custom rule, and a sentence in the docs only when nothing else can. Keep the rule set small: rules that would flag hundreds of existing lines on day one go to a "later" list, not into the config.
4. **Write it** after the user agrees: the linter's config file, and the command in the place the repo already uses for checks (a package script, a Makefile target, the "Verification" section of the org-rules project file when the repo follows the Kokpit standard: there, propose the line and leave the edit to `/kokpit:setup` or the Owner, because org-rules are locked).
5. **Baseline.** Run the linter on the whole repo once. Report the number of problems per rule and the five noisiest files. Offer the linter's own safe autofix only for formatting-like rules, and only with consent; never mass-edit logic.
6. **On every edit?** Ask whether Kokpit should run this linter after each edit of a matching file. If yes, write only the `lint` entry in the `checks` section of `.claude/kokpit.json` (create the file when missing, keep everything else in it): `{"files": ["<glob>"], "command": "<linter> {file}"}`, with a command that takes one file and finishes in a few seconds; a slower whole-project command stays in step 4's place only. Say that Kokpit reports only problems on the lines an edit changed, and that `/kokpit` → Quality switches the checks off for this project.
7. **Report:** what was installed and written, the baseline, the "later" rules, and the one command to run the linter by hand.
