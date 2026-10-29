---
name: research
description: Investigate a question against primary sources (documentation, source code, specifications, historical sources) in a background agent and save the result, with footnotes, as a Markdown file in the repo. Use when something needs checking or facts need gathering while work continues in the meantime.
---

# Background research

Based on `research` from mattpocock/skills (MIT).

Launch a **background agent** (the Agent tool, running in the background) so the conversation can continue while it reads. Its task:

1. Investigate the question against **primary sources**: official documentation, source code, specifications; for history and folklore, scholarly sources and editions of texts, not blogs retelling them third-hand. Every claim leads to the source that establishes it.
2. Mark confidence: `[fact]` (primary source), `[uncertain]` (sources differ - say which), `[legend]` (tradition, not fact).
3. Write one Markdown file with a footnote on every claim, at `docs/research/<topic>.md` (or wherever the repo already keeps such notes).

Write the file in the language of the conversation. When the result arrives: one or two sentences of conclusion and the file path. If the research answers an open question in the decision register (Kokpit's `decisionsFile`, default `docs/decisions.md`), add a link to the file in that entry (the entry stays open; the user decides).
