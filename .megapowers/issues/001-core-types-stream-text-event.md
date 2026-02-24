---
id: 1
type: feature
status: in-progress
created: 2026-02-24T18:50:00.000Z
---

# Add StreamTextEvent types and onStreamText callback to AgentLoopConfig

Add `StreamTextEvent`, `StreamTextResult` interfaces and the optional `onStreamText` callback to `AgentLoopConfig` in `packages/agent/src/types.ts`.

These types enable mid-stream interception of LLM text output. The callback receives each text chunk plus accumulated text, and can return an abort+retry signal.
