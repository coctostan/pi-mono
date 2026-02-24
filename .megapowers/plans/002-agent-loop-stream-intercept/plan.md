## Plan: Agent Loop Stream Intercept (revised)

All work happens in `packages/agent`. Tests go in `packages/agent/test/agent-loop.test.ts` (appended to the existing file). Implementation changes are in `packages/agent/src/agent-loop.ts`.

The existing test file already has helpers (`MockAssistantStream`, `createAssistantMessage`, `createUserMessage`, `createModel`, `identityConverter`) that all tasks reuse.

**Review fixes applied:**
- Task ordering fixed: `runLoop` abort handling (Task 3) now comes before end-to-end abort+retry tests (Task 4)
- Abort path is deterministic: `streamAssistantResponse` returns immediately on abort (no waiting for stream iterator to end)
- All test imports are explicit
- No `any` in tests — unused params use `_` prefix with correct types or are omitted
- No placeholders — full pasteable code for every modified function

---

### Task 1: onStreamText callback invoked on text_delta with chunk and accumulatedText

**Spec coverage:** Acceptance criteria 1, 2, 4, 8

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/test/agent-loop.test.ts`

**Test:**

First, add `StreamTextEvent` to the test file imports. Change the existing import:

```typescript
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.js";
```

to:

```typescript
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool, StreamTextEvent } from "../src/types.js";
```

Then add a new `describe("onStreamText", ...)` block at the end of the file:

```typescript
describe("onStreamText", () => {
	it("should call onStreamText with chunk and accumulatedText on each text_delta", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		const received: StreamTextEvent[] = [];

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			onStreamText: (event) => {
				received.push({ ...event });
				return { action: "continue" };
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const partial1 = createAssistantMessage([{ type: "text", text: "Hel" }]);
				const partial2 = createAssistantMessage([{ type: "text", text: "Hello" }]);
				const final = createAssistantMessage([{ type: "text", text: "Hello world" }]);

				stream.push({ type: "start", partial: partial1 });
				stream.push({ type: "text_start", contentIndex: 0, partial: partial1 });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "Hel", partial: partial1 });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "lo", partial: partial2 });
				stream.push({ type: "text_delta", contentIndex: 0, delta: " world", partial: final });
				stream.push({ type: "text_end", contentIndex: 0, content: "Hello world", partial: final });
				stream.push({ type: "done", reason: "stop", message: final });
			});
			return stream;
		};

		const stream = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of stream) {
			/* consume */
		}

		expect(received).toEqual([
			{ chunk: "Hel", accumulatedText: "Hel" },
			{ chunk: "lo", accumulatedText: "Hello" },
			{ chunk: " world", accumulatedText: "Hello world" },
		]);
	});

	it("should not alter normal flow when onStreamText always returns continue", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		let callCount = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			onStreamText: () => {
				callCount++;
				return { action: "continue" };
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const partial = createAssistantMessage([{ type: "text", text: "ok" }]);
				const final = createAssistantMessage([{ type: "text", text: "ok" }]);
				stream.push({ type: "start", partial });
				stream.push({ type: "text_start", contentIndex: 0, partial });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "ok", partial });
				stream.push({ type: "text_end", contentIndex: 0, content: "ok", partial });
				stream.push({ type: "done", reason: "stop", message: final });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();
		expect(messages.length).toBe(2);
		expect(messages[1].role).toBe("assistant");
		expect(callCount).toBe(1);

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("agent_end");
	});

	it("should behave identically when onStreamText is not configured", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const partial = createAssistantMessage([{ type: "text", text: "ok" }]);
				const final = createAssistantMessage([{ type: "text", text: "ok" }]);
				stream.push({ type: "start", partial });
				stream.push({ type: "text_start", contentIndex: 0, partial });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "ok", partial });
				stream.push({ type: "text_end", contentIndex: 0, content: "ok", partial });
				stream.push({ type: "done", reason: "stop", message: final });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();
		expect(messages.length).toBe(2);
		expect(messages[1].role).toBe("assistant");

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("agent_end");
	});
});
```

**Implementation:**

In `packages/agent/src/agent-loop.ts`, add `accumulatedText` tracking and `onStreamText` invocation inside `streamAssistantResponse`. The only change is in the `text_delta` case of the event loop. Replace the entire `streamAssistantResponse` function with:

```typescript
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
): Promise<AssistantMessage> {
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	// Build LLM context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};

	const streamFunction = streamFn || streamSimple;

	// Resolve API key (important for expiring tokens)
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	const response = await streamFunction(config.model, llmContext, {
		...config,
		apiKey: resolvedApiKey,
		signal,
	});

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;
	let accumulatedText = "";

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				stream.push({ type: "message_start", message: { ...partialMessage } });
				break;

			case "text_delta": {
				if (config.onStreamText) {
					accumulatedText += event.delta;
					const result = config.onStreamText({ chunk: event.delta, accumulatedText });
					if (result.action === "abort") {
						// Handled in Task 2 — for now fall through to normal processing
					}
				}
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partialMessage },
					});
				}
				break;
			}

			case "text_start":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end":
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partialMessage },
					});
				}
				break;

			case "done":
			case "error": {
				const finalMessage = await response.result();
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				if (!addedPartial) {
					stream.push({ type: "message_start", message: { ...finalMessage } });
				}
				stream.push({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	return await response.result();
}
```

Note: The `text_delta` abort branch is a no-op stub (`// Handled in Task 2`). Task 1 only wires up the callback invocation and accumulation — the abort path is implemented in Task 2.

**Verify:**
```bash
cd packages/agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts
```

---

### Task 2: streamAssistantResponse returns immediately on onStreamText abort [depends: 1]

**Spec coverage:** Acceptance criteria 3, 5, 11

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/test/agent-loop.test.ts`

**Test:**

Add inside the `describe("onStreamText", ...)` block. This test calls `streamAssistantResponse` indirectly through `agentLoop` — but since `runLoop` doesn't handle abort markers yet (Task 3), it tests that the function returns an abort marker by checking that `context.messages` has the partial removed and the agent ends (with an error, since `runLoop` will try to access `.stopReason` on the abort marker and fail gracefully).

Actually, to cleanly test just `streamAssistantResponse` behavior, we test through `agentLoop` and verify the observable side effects: partial message removal and no crash. Since `runLoop` doesn't handle the abort marker yet, the function's return value won't have `.stopReason`, so `runLoop` will treat it as a non-error/non-abort and try to check for tool calls — which will be empty — and the loop will end normally. This is actually a valid test:

```typescript
	it("should return abort marker and remove partial message from context on onStreamText abort", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			onStreamText: (event) => {
				if (event.accumulatedText.includes("bad")) {
					return { action: "abort", content: "Do not say bad" };
				}
				return { action: "continue" };
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const partial1 = createAssistantMessage([{ type: "text", text: "This is " }]);
				const partial2 = createAssistantMessage([{ type: "text", text: "This is bad stuff" }]);
				stream.push({ type: "start", partial: partial1 });
				stream.push({ type: "text_start", contentIndex: 0, partial: partial1 });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "This is ", partial: partial1 });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "bad stuff", partial: partial2 });
				// These events come after abort — they should be ignored
				stream.push({ type: "text_end", contentIndex: 0, content: "This is bad stuff", partial: partial2 });
				stream.push({ type: "done", reason: "stop", message: partial2 });
			});
			return stream;
		};

		const stream = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of stream) {
			/* consume */
		}

		// The partial assistant message should have been removed from context
		// Only the initial user message should remain (abort marker is not an AssistantMessage)
		const assistantMessages = context.messages.filter((m) => m.role === "assistant");
		expect(assistantMessages.length).toBe(0);
	});
```

**Implementation:**

Replace the entire `streamAssistantResponse` function in `packages/agent/src/agent-loop.ts`. The key changes from Task 1:
1. Add `import type { ImageContent, TextContent, UserMessage } from "@mariozechner/pi-ai";` to the imports
2. Change return type to `Promise<AssistantMessage | { aborted: true; content: string | (TextContent | ImageContent)[] }>`
3. On `text_delta` abort: immediately remove partial message, abort child controller, and return the abort marker
4. Use a child `AbortController` linked to the outer signal

First, update the import at the top of `agent-loop.ts`. Change:

```typescript
import {
	type AssistantMessage,
	type Context,
	EventStream,
	streamSimple,
	type ToolResultMessage,
	validateToolArguments,
} from "@mariozechner/pi-ai";
```

to:

```typescript
import {
	type AssistantMessage,
	type Context,
	EventStream,
	type ImageContent,
	streamSimple,
	type TextContent,
	type ToolResultMessage,
	type UserMessage,
	validateToolArguments,
} from "@mariozechner/pi-ai";
```

Then replace the full `streamAssistantResponse` function:

```typescript
/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 *
 * Returns either an AssistantMessage (normal completion) or an abort marker
 * when onStreamText triggers an abort.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
): Promise<AssistantMessage | { aborted: true; content: string | (TextContent | ImageContent)[] }> {
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	// Build LLM context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};

	const streamFunction = streamFn || streamSimple;

	// Child abort controller linked to outer signal
	const childController = new AbortController();
	if (signal) {
		if (signal.aborted) {
			childController.abort(signal.reason);
		} else {
			signal.addEventListener("abort", () => childController.abort(signal.reason), { once: true });
		}
	}

	// Resolve API key (important for expiring tokens)
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	const response = await streamFunction(config.model, llmContext, {
		...config,
		apiKey: resolvedApiKey,
		signal: childController.signal,
	});

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;
	let accumulatedText = "";

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				stream.push({ type: "message_start", message: { ...partialMessage } });
				break;

			case "text_delta": {
				if (config.onStreamText) {
					accumulatedText += event.delta;
					const result = config.onStreamText({ chunk: event.delta, accumulatedText });
					if (result.action === "abort") {
						// Remove partial assistant message from context
						if (addedPartial) {
							context.messages.pop();
						}
						// Abort the HTTP stream
						childController.abort("onStreamText abort");
						// Return immediately with abort marker
						return { aborted: true, content: result.content };
					}
				}
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partialMessage },
					});
				}
				break;
			}

			case "text_start":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end":
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partialMessage },
					});
				}
				break;

			case "done":
			case "error": {
				const finalMessage = await response.result();
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				if (!addedPartial) {
					stream.push({ type: "message_start", message: { ...finalMessage } });
				}
				stream.push({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	return await response.result();
}
```

**Verify:**
```bash
cd packages/agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts
```

---

### Task 3: runLoop handles onStreamText abort by injecting correction message [depends: 2]

**Spec coverage:** Acceptance criteria 6, 7

**Files:**
- Modify: `packages/agent/src/agent-loop.ts`
- Modify: `packages/agent/test/agent-loop.test.ts`

**Test:**

Add inside the `describe("onStreamText", ...)` block:

```typescript
	it("should inject abort content as a UserMessage and continue the loop", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		let llmCallCount = 0;
		const llmContextSnapshots: Message[][] = [];

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (msgs) => {
				const converted = identityConverter(msgs);
				llmContextSnapshots.push(converted.map((m) => ({ ...m })));
				return converted;
			},
			onStreamText: (event) => {
				if (event.accumulatedText.includes("forbidden")) {
					return { action: "abort", content: "RULE: Do not use the word forbidden." };
				}
				return { action: "continue" };
			},
		};

		const streamFn = () => {
			llmCallCount++;
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (llmCallCount === 1) {
					const partial = createAssistantMessage([{ type: "text", text: "forbidden" }]);
					stream.push({ type: "start", partial });
					stream.push({ type: "text_start", contentIndex: 0, partial });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "forbidden", partial });
					stream.push({ type: "text_end", contentIndex: 0, content: "forbidden", partial });
					stream.push({ type: "done", reason: "stop", message: partial });
				} else {
					const final = createAssistantMessage([{ type: "text", text: "allowed" }]);
					stream.push({ type: "start", partial: final });
					stream.push({ type: "text_start", contentIndex: 0, partial: final });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "allowed", partial: final });
					stream.push({ type: "text_end", contentIndex: 0, content: "allowed", partial: final });
					stream.push({ type: "done", reason: "stop", message: final });
				}
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([createUserMessage("test")], context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}

		// Should have called LLM twice (abort + retry)
		expect(llmCallCount).toBe(2);

		// Second LLM call should see the injected user message
		expect(llmContextSnapshots.length).toBe(2);
		const secondCallMessages = llmContextSnapshots[1];
		const injectedMsg = secondCallMessages.find(
			(m) =>
				m.role === "user" &&
				typeof m.content === "string" &&
				m.content === "RULE: Do not use the word forbidden.",
		);
		expect(injectedMsg).toBeDefined();

		// No partial assistant message should be in the second call's context
		const assistantInSecondCall = secondCallMessages.filter((m) => m.role === "assistant");
		expect(assistantInSecondCall.length).toBe(0);

		// The injected user message should also appear as a message event
		const userMsgEvents = events.filter(
			(e) =>
				e.type === "message_start" &&
				e.message.role === "user" &&
				typeof e.message.content === "string" &&
				e.message.content === "RULE: Do not use the word forbidden.",
		);
		expect(userMsgEvents.length).toBe(1);

		// Agent should end normally
		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();
	});
```

**Implementation:**

In `runLoop` inside `packages/agent/src/agent-loop.ts`, change the line that calls `streamAssistantResponse` and the lines immediately after it. Find this block:

```typescript
			// Stream assistant response
			const message = await streamAssistantResponse(currentContext, config, signal, stream, streamFn);
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
```

Replace it with:

```typescript
			// Stream assistant response
			const streamResult = await streamAssistantResponse(currentContext, config, signal, stream, streamFn);

			// Check for onStreamText abort
			if ("aborted" in streamResult) {
				// Convert abort content to UserMessage and set as pending
				const correctionMessage: UserMessage = {
					role: "user",
					content: streamResult.content,
					timestamp: Date.now(),
				};
				pendingMessages = [correctionMessage];
				continue;
			}

			const message = streamResult;
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
```

**Verify:**
```bash
cd packages/agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts
```

---

### Task 4: End-to-end abort+retry removes partial and keeps only clean message [depends: 3]

**Spec coverage:** Acceptance criteria 3, 5, 7 (end-to-end verification)

**Files:**
- Modify: `packages/agent/test/agent-loop.test.ts`

**Test:**

Add inside the `describe("onStreamText", ...)` block:

```typescript
	it("should abort stream, remove partial message, and retry with clean response", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		let llmCallCount = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			onStreamText: (event) => {
				if (event.accumulatedText.includes("bad")) {
					return { action: "abort", content: "Do not say bad" };
				}
				return { action: "continue" };
			},
		};

		const streamFn = () => {
			llmCallCount++;
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (llmCallCount === 1) {
					const partial1 = createAssistantMessage([{ type: "text", text: "This is " }]);
					const partial2 = createAssistantMessage([{ type: "text", text: "This is bad" }]);
					stream.push({ type: "start", partial: partial1 });
					stream.push({ type: "text_start", contentIndex: 0, partial: partial1 });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "This is ", partial: partial1 });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "bad", partial: partial2 });
					stream.push({ type: "text_end", contentIndex: 0, content: "This is bad", partial: partial2 });
					stream.push({ type: "done", reason: "stop", message: partial2 });
				} else {
					const final = createAssistantMessage([{ type: "text", text: "This is good" }]);
					stream.push({ type: "start", partial: final });
					stream.push({ type: "text_start", contentIndex: 0, partial: final });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "This is good", partial: final });
					stream.push({ type: "text_end", contentIndex: 0, content: "This is good", partial: final });
					stream.push({ type: "done", reason: "stop", message: final });
				}
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		// Should have called LLM twice (abort + retry)
		expect(llmCallCount).toBe(2);

		// The partial "bad" message should NOT be in context.messages
		const assistantMessages = context.messages.filter((m) => m.role === "assistant");
		expect(assistantMessages.length).toBe(1);
		expect((assistantMessages[0] as AssistantMessage).content[0]).toEqual({
			type: "text",
			text: "This is good",
		});

		// Agent should end normally
		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();
	});
```

**Implementation:** No new implementation — this validates the combination of Tasks 2 and 3.

**Verify:**
```bash
cd packages/agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts
```

---

### Task 5: accumulatedText resets per assistant response [depends: 3]

**Spec coverage:** Acceptance criteria 8

**Files:**
- Modify: `packages/agent/test/agent-loop.test.ts`

**Test:**

Add inside the `describe("onStreamText", ...)` block:

```typescript
	it("should reset accumulatedText for each new assistant response", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		const allAccumulated: string[] = [];
		let abortOnce = true;

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			onStreamText: (event) => {
				allAccumulated.push(event.accumulatedText);
				if (abortOnce && event.accumulatedText === "first") {
					abortOnce = false;
					return { action: "abort", content: "retry" };
				}
				return { action: "continue" };
			},
		};

		let llmCallCount = 0;
		const streamFn = () => {
			llmCallCount++;
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (llmCallCount === 1) {
					const partial = createAssistantMessage([{ type: "text", text: "first" }]);
					stream.push({ type: "start", partial });
					stream.push({ type: "text_start", contentIndex: 0, partial });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "first", partial });
					stream.push({ type: "text_end", contentIndex: 0, content: "first", partial });
					stream.push({ type: "done", reason: "stop", message: partial });
				} else {
					const partial1 = createAssistantMessage([{ type: "text", text: "second" }]);
					const final = createAssistantMessage([{ type: "text", text: "second!" }]);
					stream.push({ type: "start", partial: partial1 });
					stream.push({ type: "text_start", contentIndex: 0, partial: partial1 });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "second", partial: partial1 });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "!", partial: final });
					stream.push({ type: "text_end", contentIndex: 0, content: "second!", partial: final });
					stream.push({ type: "done", reason: "stop", message: final });
				}
			});
			return stream;
		};

		const stream = agentLoop([createUserMessage("go")], context, config, undefined, streamFn);
		for await (const _ of stream) {
			/* consume */
		}

		// First response: accumulated "first" then abort
		// Second response: accumulated "second", then "second!" — NOT "firstsecond"
		expect(allAccumulated).toEqual(["first", "second", "second!"]);
	});
```

**Implementation:** Already handled — `accumulatedText` is a local variable inside `streamAssistantResponse`, so it resets on each call. This test validates that property.

**Verify:**
```bash
cd packages/agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts
```

---

### Task 6: Outer signal abort propagates through child controller [depends: 2]

**Spec coverage:** Acceptance criteria 9, 10

**Files:**
- Modify: `packages/agent/test/agent-loop.test.ts`

**Test:**

Add inside the `describe("onStreamText", ...)` block:

```typescript
	it("should abort when outer signal fires, preserving user-cancel behavior", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			onStreamText: () => ({ action: "continue" }),
		};

		const outerController = new AbortController();
		let childSignalAborted = false;

		const streamFn = (_model: Model<"openai-responses">, _ctx: Context, options: Record<string, unknown>) => {
			const passedSignal = options.signal as AbortSignal;

			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const partial = createAssistantMessage([{ type: "text", text: "" }], "aborted");
				mockStream.push({ type: "start", partial });
				mockStream.push({ type: "text_start", contentIndex: 0, partial });
				mockStream.push({ type: "text_delta", contentIndex: 0, delta: "hel", partial });

				// Fire outer abort
				outerController.abort();

				// The child signal should also be aborted
				childSignalAborted = passedSignal.aborted;

				// Simulate what the real stream does on abort
				const errorMsg = createAssistantMessage([{ type: "text", text: "hel" }], "aborted");
				mockStream.push({ type: "error", reason: "aborted", error: errorMsg });
			});
			return mockStream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([createUserMessage("hi")], context, config, outerController.signal, streamFn);
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		// Child signal should have been aborted when outer signal fired
		expect(childSignalAborted).toBe(true);

		// Should have ended with aborted stop reason
		const assistantMsg = messages.find((m) => m.role === "assistant") as AssistantMessage;
		expect(assistantMsg.stopReason).toBe("aborted");

		// Agent should end (not retry)
		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();
	});
```

This test also needs `Context` and `Model` imported in the test file. Update the existing pi-ai import:

```typescript
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
```

**Implementation:** Already handled by the child `AbortController` setup in Task 2.

**Verify:**
```bash
cd packages/agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts
```

---

### Task 7: Run full check

**Spec coverage:** All criteria (regression check)

**Files:**
- None (verification only)

**Verify:**
```bash
cd packages/agent && npm run check
```

This ensures no type errors, lint issues, or regressions across the package.
