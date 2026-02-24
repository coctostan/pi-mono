## Approach

Add three new type definitions to `packages/agent/src/types.ts`: `StreamTextEvent`, `StreamTextResult`, and an `onStreamText` optional property on `AgentLoopConfig`. These types define the contract for mid-stream text interception. The callback is synchronous, receives each text chunk plus accumulated text, and returns a discriminated union — either `continue` (no-op) or `abort` with content to inject. The abort payload uses `string | (TextContent | ImageContent)[]`, matching the existing content shape used by `UserMessage` in the AI package.

This is a pure types-only change. No runtime behavior changes. The agent loop will not call the callback yet (that's issue #2). This keeps the change minimal and independently verifiable.

## Key Decisions

- **Sync callback** — on the hot path of every streamed token; TTSR rules are CPU-only string matching. Async would add unnecessary overhead.
- **Abort payload is `string | (TextContent | ImageContent)[]`** not `AgentMessage` — the agent loop owns message construction. The callback provides content, not messages.
- **Discriminated union for result** — `{ action: "continue" } | { action: "abort"; content: ... }` makes the two cases explicit and easy to exhaustively check.
- **Optional config field** — no breaking change. Existing code that doesn't set `onStreamText` is unaffected.

## Components

- `StreamTextEvent` interface (chunk + accumulatedText)
- `StreamTextResult` type (continue | abort discriminated union)
- `onStreamText` optional property on `AgentLoopConfig`
- Re-export from `packages/agent/src/index.ts` if types are currently re-exported there

## Testing Strategy

- `npm run check` passes with no new errors
- Type assignability test: construct all type variants, verify discriminated union narrows correctly
- Backward compat: existing `AgentLoopConfig` usages still compile without `onStreamText`
