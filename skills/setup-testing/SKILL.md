---
name: setup-testing
description: Sets up a way for Claude to test the app by hand the way a user does (launch it, drive it, look at the result, save evidence), on its own, without the rest of /kokpit:setup. Writes the "Driving the app" part of the feature map and proves it once.
argument-hint: "[what to be able to test; empty = the main user path]"
disable-model-invocation: true
allowed-tools: Read Glob Grep Bash(git ls-files *) Bash(git status *)
---

# Set up manual testing for an agent

What the user wants to be able to test (empty = the main path a user takes): $ARGUMENTS

The goal is one tested recipe an agent can follow cold: launch the app, know it is ready, drive it as a user, observe the result, keep the evidence, clean up. It ends up in `docs/features/README.md` (`docs/funkcje/README.md` in a Polish repo), section "Driving the app", which `/kokpit:verify` and any session can use. Nothing else from `/kokpit:setup` is touched. Install nothing and change no file without the user's consent. Talk in the language of the conversation.

## 1. Interview the repo, not the user

Answer from the code and ask only what you cannot observe:

- **Surface:** what a user touches: a web UI, a mobile or desktop app, a game window, a CLI or TUI, an API, a library's callers. Pick the primary one; note the rest.
- **Run:** the documented way to start it locally (package scripts, Makefile, README, editor run configs), ports, environment variables, seed data, sign-in.
- **Drive:** what the repo already has (end-to-end tests, Playwright or Cypress specs, integration tests, a debug or test scene, a headless mode, an HTTP API). Reuse before adding.
- **Observe:** what proves a state: a screenshot, a terminal transcript, a response body, a log line, a saved file read back.
- **Isolate:** can it run with its own data directory or port, so testing never touches the user's real saves or settings? If not, say so and stop before driving a shared instance.

## 2. Pick the driver

Use what the repo has. Otherwise, by surface:

| Surface | A driver that works without a person |
|---|---|
| Web app, Electron | Playwright (`npx playwright`): roles and labels as handles, screenshots, traces |
| Flutter | `integration_test` with `flutter test integration_test/` (screenshots through the binding); Maestro for flows on a simulator |
| Native mobile | Maestro flows (YAML) on a simulator or emulator, screenshots per step |
| Godot | a test scene or a script run with `godot --path . <scene> -- <args>` that loads the scene, sends input with `Input.parse_input_event`, prints the state it reached and saves `get_viewport().get_texture().get_image()` as PNG; `--headless` for logic without pictures |
| Unity, Unreal | the engine's test runner in batch mode (`-batchmode -runTests`, automation tests) plus a scripted screenshot |
| CLI, TUI | a PTY under tmux or `expect`: send keys, capture the pane |
| HTTP API, service | `curl` or the project's client against a local instance, responses and side effects read back |

Prefer stable handles (labels, node paths, command names) over coordinates and timing. A helper script goes where the repo keeps tools, executable, with its invocation shown in the recipe.

## 3. Write the recipe

Create the feature map index if it is missing (a title, one "Read when" line, the section below, and an empty feature table) and fill "Driving the app" with exact commands, no placeholders:

- **Launch:** from an empty data directory, with any seed data; for a short-lived CLI, the build step.
- **Ready when:** the log line, port or prompt that shows it is usable, not merely running.
- **Doctor (read-only):** one check that this instance is worth driving (right build, port owned by us, data directory is the test one).
- **Drive:** the driver and how to send input, with one real example from this app.
- **Evidence:** what to capture and where (`.claude/kokpit/evidence/<feature>/<date>/`, outside git).
- **Clean up:** stop what you started (never by process name alone), remove scratch state, keep the evidence.

## 4. Prove it once

Run the recipe end to end yourself: launch, the ready check, the doctor, drive one short user path, capture evidence, clean up, then confirm the evidence is still there. Fix what fails and clean up after every failed try. A recipe that never ran is a draft: say which steps stay unproven if something could not run here (a device, a signed-in account).

## 5. Seed and hand over

Offer pages for the 2–3 main features (what the user gets, how they reach it, the steps with the recipe's commands, what end state proves it, `paths:` to the code), only if the user wants them now. Report: the recipe's location, what was proven, the evidence path, and how to use it: "test <something> like a user" in any session, or `/kokpit:verify` after a change.
