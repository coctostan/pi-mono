---
id: 4
type: feature
status: open
created: 2026-02-24T18:50:00.000Z
---

# Implement pi-ttsr extension

Create the pi-ttsr extension as a separate package with:

- **loader.ts**: Discover and parse rule files from `.pi/rules/` and `~/.pi/rules/` (markdown with YAML frontmatter)
- **matcher.ts**: Regex matching against stream text with scope handling (line, chunk, accumulated)
- **state.ts**: Per-rule firing count and cooldown tracking
- **index.ts**: Extension entry point — register `session_start` to load rules, `stream_text` to match and abort

Rule frontmatter fields: trigger (regex), flags, scope, maxFirings, cooldown.

Depends on: #3
