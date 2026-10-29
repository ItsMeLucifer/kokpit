---
name: org-rules-change
description: Changes the non-negotiable rules (.claude/org-rules/) on the Owner's instruction. Checks that protection is off, makes the change, recomputes the manifest and restores protection. Started only by the Owner.
disable-model-invocation: true
argument-hint: "<what to change in org-rules>"
---
<!-- core: 0.10.0 (Kokpit repo standard; updated by /kokpit:setup) -->

# Changing org-rules

Change: $ARGUMENTS

Only the Owner starts this skill. They remove the protection themselves in their own terminal; you do not. Do not send `--unlock` to a terminal pane, do not run a copy of the script under another name, do not edit `~/.claude/settings.json` and do not get around the deny rules in any other way. The procedure and protection layers: `.claude/org-rules/README.md`, section "Protection and change".

Run each command separately, without chaining with `&&`. The fixed deny rules match the whole command text: `python3 …` with any path containing "org-rules" will be refused.

1. **State.** `sh tools/docs/lock_org_rules.sh --status`. Protection is off when the `rules:` line lists missing `Edit(...)` entries and `chmod:` says "writable". With `LOCKED`, stop and give the Owner one command for their terminal, with the absolute path of the checkout you work in:
   ```bash
   sh <checkout path>/tools/docs/lock_org_rules.sh --unlock
   ```
   Continue only after their reply.
2. **Change.** Read the org-rules README and the files the change concerns. Make exactly what the Owner asks for, nothing more. When the change touches a rule in the summary, update the summary too. In the header of every changed file raise `version`, unless the file already has an uncommitted change with a raised version. The `00-core-*` files are shared by all repos: a change there disappears with the next core update, so suggest to the Owner that it goes into Kokpit or into the project file.
3. **Manifest and check.** `python3 tools/docs/check_docs.py --write-manifest`, then `python3 tools/docs/check_docs.py` (zero errors).
4. **Restore protection.** `sh tools/docs/lock_org_rules.sh`, then `--status` (expected `LOCKED`; in a worktree chmod is skipped and that is fine). If running it is refused, ask the Owner to run `sh tools/docs/lock_org_rules.sh` in their terminal.
5. **Probe.** Call `Edit` on `.claude/org-rules/README.md` with an `old_string` that is not in the file. "denied by your permission settings" means protection works. "String not found" means the deny rules do not work yet; say so plainly.
6. **Report.** What you changed (files and sentences), the output of `check_docs.py`, `--status` and the probe. Commit only on the Owner's instruction. A change made in a worktree reaches the main checkout with the `chmod` lock: before merging, the Owner removes the lock there (`--unlock`); after merging, `sh tools/docs/lock_org_rules.sh` is enough.
