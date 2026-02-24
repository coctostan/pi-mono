---
id: 2
type: feature
status: open
created: 2026-02-24T18:50:00.000Z
---

# Implement stream intercept in agent-loop.ts

Modify `streamAssistantResponse()` in `packages/agent/src/agent-loop.ts` to:

1. Accumulate text in the `text_delta` handler
2. Call `onStreamText` callback on each chunk
3. On abort signal: abort the stream, discard partial assistant message
4. Return a TTSR abort sentinel to the caller

Modify `runLoop()` to handle the abort sentinel:
- Inject the rule content as a pending message
- Continue the loop to retry the turn

Depends on: #1
