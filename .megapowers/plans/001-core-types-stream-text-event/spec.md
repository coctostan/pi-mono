## Goal

Add `StreamTextEvent`, `StreamTextResult`, and an `onStreamText` callback to `AgentLoopConfig` in `packages/agent/src/types.ts`. These types define the contract for mid-stream interception of LLM text output, enabling callers to inspect each text chunk and signal abort-with-content. This is a types-only change with no runtime behavior modifications.

## Acceptance Criteria

1. `packages/agent/src/types.ts` exports a `StreamTextEvent` interface with a `chunk` property (string) containing the current text delta and an `accumulatedText` property (string) containing all text received so far in the current assistant response.

2. `packages/agent/src/types.ts` exports a `StreamTextResult` discriminated union type with two variants: `{ action: "continue" }` and `{ action: "abort"; content: string | (TextContent | ImageContent)[] }`, where `TextContent` and `ImageContent` are imported from `@mariozechner/pi-ai`.

3. `AgentLoopConfig` has an optional `onStreamText` property typed as `(event: StreamTextEvent) => StreamTextResult`.

4. Existing code that constructs `AgentLoopConfig` without `onStreamText` compiles without changes (`npm run check` passes with zero errors).

5. A value of type `StreamTextResult` can be narrowed via `result.action === "abort"` to access the `content` property (discriminated union works correctly).

6. The new types are publicly accessible via `import { StreamTextEvent, StreamTextResult } from "@mariozechner/pi-agent"` (covered by existing `export *` from `types.js` in `index.ts`).

## Out of Scope

- Calling `onStreamText` from the agent loop (issue #2)
- Injecting abort content as a pending message (issue #2)
- Extension system wiring (issue #3)
- TTSR rule files and matching logic (issue #4)
- Runtime tests of callback invocation behavior

## Open Questions

None.
