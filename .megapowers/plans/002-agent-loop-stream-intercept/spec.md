## Goal

Implement the `onStreamText` callback mechanism in the agent loop so that callers can inspect LLM output as it streams and abort+retry with a correction message when the output violates rules. The types (`StreamTextEvent`, `StreamTextResult`, `onStreamText` on `AgentLoopConfig`) already exist; this issue wires them into `streamAssistantResponse` and `runLoop` in `agent-loop.ts`.

## Acceptance Criteria

1. During assistant response streaming, each `text_delta` event causes `config.onStreamText` to be called with the current chunk and all text accumulated so far in that response.

2. When `onStreamText` returns `{ action: "continue" }`, streaming proceeds normally with no observable change in behavior.

3. When `onStreamText` returns `{ action: "abort", content: "..." }`, the in-flight HTTP stream is aborted via signal (child `AbortController`).

4. When `onStreamText` is not configured, streaming behavior is identical to the current implementation (no regression).

5. After an `onStreamText` abort, the partial assistant message that was appended to `context.messages` during streaming is removed from the context.

6. After an `onStreamText` abort, the abort content is converted to a `UserMessage` and set as a pending message for the next inner-loop iteration.

7. After an `onStreamText` abort, the agent loop continues (does not return or end the stream) — the next iteration streams a new assistant response with the injected user message.

8. The `accumulatedText` passed to `onStreamText` resets to empty at the start of each assistant response, not carried over from previous responses.

9. When the outer signal (user cancel) fires, the child `AbortController` also aborts, preserving existing user-cancel behavior.

10. When the outer signal fires during streaming and `onStreamText` has not triggered an abort, the function returns with `stopReason: "aborted"` as it does today.

11. The `streamAssistantResponse` return value distinguishes a normal completion from an `onStreamText`-triggered abort so that `runLoop` can branch on it.

## Out of Scope

- Retry limiting (`maxStreamTextRetries`) — the caller is responsible for tracking retries in callback state.
- New message types — the injected correction uses the existing `UserMessage` type.
- New config fields — `onStreamText`, `StreamTextEvent`, and `StreamTextResult` are already defined in `types.ts`.
- Changes to tool execution or steering message flows.
- Emitting new `AgentEvent` types for the abort — reuses existing event lifecycle.

## Open Questions

None.
