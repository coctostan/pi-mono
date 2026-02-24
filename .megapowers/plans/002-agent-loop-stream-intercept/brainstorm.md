## Approach

`streamAssistantResponse` gets a child `AbortController` linked to the outer signal. On each `text_delta` event, it accumulates text and calls `config.onStreamText` with the chunk and accumulated text. If the callback returns `{ action: "abort" }`, the child controller fires, killing the HTTP stream via the same signal-based mechanism pi already uses. The function returns a tagged result distinguishing normal completion from TTSR abort.

`runLoop` checks the return value. On TTSR abort, it removes the partial assistant message from `context.messages`, converts the abort content into a `UserMessage`, sets it as `pendingMessages`, and continues the inner while-loop. The next iteration picks up the pending message and streams a new response — identical to the existing steering message flow.

No new message types, no new config fields beyond `onStreamText` (already added in issue #1). The callback is responsible for its own retry-limiting if needed.

## Key Decisions

- Child `AbortController` for TTSR abort — reuses the existing signal-based abort mechanism rather than inventing a new one
- `pendingMessages` with `UserMessage` for retry injection — reuses the existing steering message path, no new plumbing
- No `maxStreamTextRetries` — caller controls retry behavior via callback state (noted as future consideration for infinite-loop risk)
- Partial assistant message is removed on abort — the LLM sees a clean conversation without fragments

## Components

- `streamAssistantResponse` in `agent-loop.ts` — text accumulation, callback invocation, child abort controller
- `runLoop` in `agent-loop.ts` — TTSR abort handling, message cleanup, pending message injection
- Helper to convert `StreamTextResult.content` into a `UserMessage`

## Testing Strategy

- Unit test: mock stream function that emits text events, `onStreamText` returns abort on a trigger phrase, verify the partial message is removed and a user message is injected
- Unit test: `onStreamText` always returns continue — verify normal flow is unaffected
- Unit test: verify child abort controller fires when outer signal fires (user cancel still works)
- Unit test: verify `accumulatedText` resets per assistant response, not per loop iteration
