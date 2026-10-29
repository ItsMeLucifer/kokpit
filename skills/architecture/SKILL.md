---
name: architecture
description: Architecture review that looks for places to deepen modules (shallow modules, leaky seams, logic that is hard to test) and presents them in an HTML report with before/after diagrams. Run manually, in spare time, or when a diagnosis found there was no seam to test at.
disable-model-invocation: true
argument-hint: "[area, e.g. src/core/orders; empty = hot spots from git history]"
---

# Architecture: deepening opportunities

Based on `improve-codebase-architecture` and `codebase-design` from mattpocock/skills (MIT).

Write the report and all questions in the language of the conversation.

Area: $ARGUMENTS

## Vocabulary (use exactly these words)

- **Module** - anything with an interface and an implementation (function, class, script, a set of scripts).
- **Interface** - everything a caller must know: signatures, but also invariants, call ordering, failure modes, required configuration.
- **Depth** - how much behaviour the caller (and a test) gets per unit of interface. Deep: a lot behind a small interface. Shallow: an interface nearly as complex as the implementation.
- **Seam** - a place where behaviour can be changed without editing in that place; the interface lives there.
- **Adapter** - a concrete thing satisfying an interface at a seam (e.g. an in-memory fake of a database as an adapter for tests).
- **Leverage** (for callers) and **locality** (for maintainers: change, bugs and knowledge in one place).

Rules: the **deletion test** - imagine deleting the module; if the complexity vanishes it was a pass-through, if it reappears in N places it was earning its keep. **The interface is the test surface** - wanting to test "behind" the interface means the module has the wrong shape. **One adapter = a hypothetical seam, two = a real one** (production plus a test double or a second implementation).

## Steps

1. **Scope.** The given area, or hot spots: `git log --name-only --since="6 weeks ago"` gives the most frequently changed files. Read the area's documents in `docs/` and the resolved entries in the decision register (Kokpit's `decisionsFile`, default `docs/decisions.md`); do not challenge those without a strong reason.
2. **Explore** in a subagent: where understanding one thing requires hopping between many small modules; where modules are shallow; where pure functions were extracted "for testing" while the bugs live in how they are called; where modules leak across seams; what is untested or hard to test through the current interface. Apply the deletion test to every suspect.
3. **HTML report** at `$TMPDIR/architecture-<timestamp>.html` (outside the repo); open it (`open` / `xdg-open`) and give the path. One card per candidate: files, problem, solution (in prose), benefits in terms of leverage, locality and tests, a before/after diagram (Mermaid from a CDN for dependency graphs, hand-written SVG for the rest), and a strength of recommendation: Strong / Worth investigating / Speculative. End with "Do this first" and a justification. Do not propose interfaces yet.
4. **Ask** which candidate to dig into. After the choice, walk the decision tree with `/grill` (constraints, dependencies, the shape of the deepened module, what sits behind the seam, which tests survive). If interfaces need comparing, run 3 subagents in parallel, each with a different constraint (minimal interface with 1-3 entry points; maximum flexibility; simplest common case), then compare them on depth, locality and seam placement. If a candidate is rejected for a lasting reason, add an entry to the decision register in the entry format from Kokpit's system-prompt note, so the next review does not propose it again.
