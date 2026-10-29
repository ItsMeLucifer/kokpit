# headroom and graphify: why they are optional

Analysis from October 2026. Versions: headroom 0.41.0, graphify 0.9.92; both read from their repositories, nothing executed from them. Claude Code documentation: code.claude.com/docs (llm-gateway, mcp, memory, sub-agents, skills, plugins).

The question was whether two popular token-saving tools should become part of Kokpit's default setup, and whether either could replace the handoff.

## Verdict

| | Projects in languages graphify parses | Projects in other languages (e.g. GDScript) | Replaces the handoff? |
| --- | --- | --- | --- |
| **headroom** (compressing proxy) | only a terminal trial, for long logs and JSON | no | no |
| **graphify** (code graph) | yes, optional, code-only mode | no | no |

The biggest savings are elsewhere: in the measured session about **92k tokens** of fixed overhead were spent before the first instruction.

## Measurement: where the tokens go

Context window of a working session (Opus 5.5, 1M window), at 180k used:

| Category | Tokens | What it is |
| --- | ---: | --- |
| System tools | 27.8k | Claude Code's tools |
| MCP tools | 23.4k | MCP servers and connectors |
| Memory files | 21.0k | a 63 KB, 392-line `CLAUDE.md` |
| System prompt | 10.4k | |
| Skills | 10.0k | descriptions of every installed skill |
| **Total before any work** | **~92.5k** | paid in every session and (apart from CLAUDE.md for Explore/Plan) in every subagent |

The same project had 27 handoff threads (425 KB); the five largest were 24–37 KB, i.e. 8–12k tokens at every `/resume`.

## headroom

**What it does:** a local proxy between Claude Code and the API. It compresses what the agent reads (JSON, logs, code) and keeps the originals locally for retrieval.

**Why it is not a default:**

1. **The Code tab of the desktop app bypasses the proxy.** The desktop app overrides `ANTHROPIC_BASE_URL` when it starts an agent session; routing there comes from the app's own third-party inference settings.
2. **Remote Control turns off** when the API address is not `api.anthropic.com`.
3. **MCP tool search turns off** with a foreign host, so every MCP tool schema loads up front. `headroom wrap` sets `ENABLE_TOOL_SEARCH=true`; a manual setup easily loses it and then spends more tokens.
4. **Little to compress in typical coding work.**
   - The default `cache` mode (chosen so the prompt cache is not broken) replays older turns byte for byte and compresses only the new increment; its own changelog says `tokens_saved` is almost always 0 in this mode.
   - The coding profile never compresses file reads lossily, and grep output passes unchanged.
   - What remains is long test logs, which Kokpit keeps out of context anyway: background jobs return the result, not the log.
5. **Risks:** streaming responses can switch to non-streaming; telemetry is on by default; copies of tool results are stored in plain text; `wrap` registers its MCP server for the whole machine unless `--no-mcp` is given; without `--1m` the window drops to 200k.

**When it makes sense:** terminal sessions with large JSON or log output, without Remote Control. A trace-free trial: `skills/setup/scripts/claude-hr.sh`; the result after a few sessions: `headroom savings`.

## graphify

**What it does:** parses code with tree-sitter into a graph (`graphify-out/graph.json`); Claude queries the graph instead of grepping. PreToolUse hooks push it that way.

**Where it does not fit:**

1. **Unsupported languages stay out of the graph.** GDScript (`.gd`), Godot scenes and resources (`.tscn`, `.tres`) and shaders are not parsed. In the Godot project analysed, the graph would have held 26% of the code (only the Python tooling).
2. **The hooks would then send Claude to a graph without the main code** ("MANDATORY… You MUST run graphify" fires on Grep and on Bash with grep/rg/find).
3. **The semantic pass (documents, images) runs as Claude subagents on your subscription**, 20–25 files per subagent and one chunk per image.
4. **Worktrees:** the git hooks exit at once in a linked worktree, so an agent there works on a stale graph.
5. **`graphify install` adds a block to `~/.claude/CLAUDE.md`** that `graphify uninstall` does not remove. Kokpit's setup only uses `graphify claude install` inside a project.

**Where it fits:** projects in supported languages, in code-only mode. The AST pass is local, without an LLM and without telemetry; the hook does not block and fails safely. The setup turns it on only where the check finds ≥ 60% of the code in the graph.

## Can either replace the handoff?

| Need | handoff | headroom | graphify |
| --- | --- | --- | --- |
| The user's decisions in their own words | yes | no | no |
| Tried and dropped | yes | no | partly (`dead_end` for graph queries) |
| Next steps, quick start | yes | no | no |
| Fewer tokens per session | no | a little, terminal only | yes, in supported languages |

No. Both tools reduce tokens; the handoff carries knowledge between sessions.

## What Kokpit does instead

1. **Cut the fixed overhead**, the largest gain without installing anything:
   - keep the entry file short and lazy-load the rest: `.claude/rules/*.md` with `paths:` load only when Claude reads matching files (the repo standard enforces a startup budget);
   - disable per project the MCP servers and skills a project does not use (`/tools` hides skills with `skillOverrides`);
   - keep handoff threads lean: the archive and older log entries move to `<thread>.archive.md`, and the validator warns above 20 KB.
2. **graphify:** `setup.sh project --graphify` only in projects the check says fit.
3. **headroom:** `--headroom` only as a terminal trial (`claude-hr.sh`); never `ANTHROPIC_BASE_URL` in `settings.json`.
