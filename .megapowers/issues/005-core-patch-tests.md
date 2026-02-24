---
id: 5
type: feature
status: open
created: 2026-02-24T18:50:00.000Z
---

# Tests for onStreamText core patch

Write tests in `packages/agent/test/`:

- Mock stream emitting text chunks, verify abort halts the stream
- Verify partial assistant message is removed from context on abort
- Verify injected message appears in the next turn's message list
- Verify no-op when onStreamText callback is undefined (zero overhead path)
- Integration test: rule triggers on known pattern, model retries with rule injected

Depends on: #2
