---
id: 3
type: feature
status: open
created: 2026-02-24T18:50:00.000Z
---

# Wire stream_text extension event in coding-agent

1. Add `StreamTextEvent` and `StreamTextEventResult` types to `packages/coding-agent/src/core/extensions/types.ts`
2. Add `on("stream_text", ...)` overload to the extension API
3. Wire `onStreamText` in agent-session.ts to emit `stream_text` through the extension runner

This connects the core agent hook to the extension system so extensions like pi-ttsr can register handlers.

Depends on: #1, #2
