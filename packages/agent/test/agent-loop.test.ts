import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { agentLoop, agentLoopContinue } from "../src/agent-loop.js";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	StreamFn,
	StreamTextEvent,
} from "../src/types.js";

// Mock stream for testing - mimics MockAssistantStream
class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

// Simple identity converter for tests - just passes through standard messages
function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

describe("agentLoop with AgentMessage", () => {
	it("should emit events with AgentMessage types", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};

		const userPrompt: AgentMessage = createUserMessage("Hello");

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Hi there!" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		// Should have user message and assistant message
		expect(messages.length).toBe(2);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");

		// Verify event sequence
		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("agent_start");
		expect(eventTypes).toContain("turn_start");
		expect(eventTypes).toContain("message_start");
		expect(eventTypes).toContain("message_end");
		expect(eventTypes).toContain("turn_end");
		expect(eventTypes).toContain("agent_end");
	});

	it("should handle custom message types via convertToLlm", async () => {
		// Create a custom message type
		interface CustomNotification {
			role: "notification";
			text: string;
			timestamp: number;
		}

		const notification: CustomNotification = {
			role: "notification",
			text: "This is a notification",
			timestamp: Date.now(),
		};

		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [notification as unknown as AgentMessage], // Custom message in context
			tools: [],
		};

		const userPrompt: AgentMessage = createUserMessage("Hello");

		let convertedMessages: Message[] = [];
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (messages) => {
				// Filter out notifications, convert rest
				convertedMessages = messages
					.filter((m) => (m as { role: string }).role !== "notification")
					.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
				return convertedMessages;
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		// The notification should have been filtered out in convertToLlm
		expect(convertedMessages.length).toBe(1); // Only user message
		expect(convertedMessages[0].role).toBe("user");
	});

	it("should apply transformContext before convertToLlm", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [
				createUserMessage("old message 1"),
				createAssistantMessage([{ type: "text", text: "old response 1" }]),
				createUserMessage("old message 2"),
				createAssistantMessage([{ type: "text", text: "old response 2" }]),
			],
			tools: [],
		};

		const userPrompt: AgentMessage = createUserMessage("new message");

		let transformedMessages: AgentMessage[] = [];
		let convertedMessages: Message[] = [];

		const config: AgentLoopConfig = {
			model: createModel(),
			transformContext: async (messages) => {
				// Keep only last 2 messages (prune old ones)
				transformedMessages = messages.slice(-2);
				return transformedMessages;
			},
			convertToLlm: (messages) => {
				convertedMessages = messages.filter(
					(m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
				) as Message[];
				return convertedMessages;
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const _ of stream) {
			// consume
		}

		// transformContext should have been called first, keeping only last 2
		expect(transformedMessages.length).toBe(2);
		// Then convertToLlm receives the pruned messages
		expect(convertedMessages.length).toBe(2);
	});

	it("should handle tool calls and results", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed.push(params.value);
				return {
					content: [{ type: "text", text: `echoed: ${params.value}` }],
					details: { value: params.value },
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const userPrompt: AgentMessage = createUserMessage("echo something");

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					// First call: return tool call
					const message = createAssistantMessage(
						[{ type: "toolCall", id: "tool-1", name: "echo", arguments: { value: "hello" } }],
						"toolUse",
					);
					stream.push({ type: "done", reason: "toolUse", message });
				} else {
					// Second call: return final response
					const message = createAssistantMessage([{ type: "text", text: "done" }]);
					stream.push({ type: "done", reason: "stop", message });
				}
				callIndex++;
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		// Tool should have been executed
		expect(executed).toEqual(["hello"]);

		// Should have tool execution events
		const toolStart = events.find((e) => e.type === "tool_execution_start");
		const toolEnd = events.find((e) => e.type === "tool_execution_end");
		expect(toolStart).toBeDefined();
		expect(toolEnd).toBeDefined();
		if (toolEnd?.type === "tool_execution_end") {
			expect(toolEnd.isError).toBe(false);
		}
	});

	it("should inject queued messages and skip remaining tool calls", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed.push(params.value);
				return {
					content: [{ type: "text", text: `ok:${params.value}` }],
					details: { value: params.value },
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const userPrompt: AgentMessage = createUserMessage("start");
		const queuedUserMessage: AgentMessage = createUserMessage("interrupt");

		let queuedDelivered = false;
		let callIndex = 0;
		let sawInterruptInContext = false;

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getSteeringMessages: async () => {
				// Return steering message after first tool executes
				if (executed.length === 1 && !queuedDelivered) {
					queuedDelivered = true;
					return [queuedUserMessage];
				}
				return [];
			},
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, (_model, ctx, _options) => {
			// Check if interrupt message is in context on second call
			if (callIndex === 1) {
				sawInterruptInContext = ctx.messages.some(
					(m) => m.role === "user" && typeof m.content === "string" && m.content === "interrupt",
				);
			}

			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					// First call: return two tool calls
					const message = createAssistantMessage(
						[
							{ type: "toolCall", id: "tool-1", name: "echo", arguments: { value: "first" } },
							{ type: "toolCall", id: "tool-2", name: "echo", arguments: { value: "second" } },
						],
						"toolUse",
					);
					mockStream.push({ type: "done", reason: "toolUse", message });
				} else {
					// Second call: return final response
					const message = createAssistantMessage([{ type: "text", text: "done" }]);
					mockStream.push({ type: "done", reason: "stop", message });
				}
				callIndex++;
			});
			return mockStream;
		});

		for await (const event of stream) {
			events.push(event);
		}

		// Only first tool should have executed
		expect(executed).toEqual(["first"]);

		// Second tool should be skipped
		const toolEnds = events.filter(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnds.length).toBe(2);
		expect(toolEnds[0].isError).toBe(false);
		expect(toolEnds[1].isError).toBe(true);
		if (toolEnds[1].result.content[0]?.type === "text") {
			expect(toolEnds[1].result.content[0].text).toContain("Skipped due to queued user message");
		}

		// Queued message should appear in events
		const queuedMessageEvent = events.find(
			(e) =>
				e.type === "message_start" &&
				e.message.role === "user" &&
				typeof e.message.content === "string" &&
				e.message.content === "interrupt",
		);
		expect(queuedMessageEvent).toBeDefined();

		// Interrupt message should be in context when second LLM call is made
		expect(sawInterruptInContext).toBe(true);
	});
});

describe("agentLoopContinue with AgentMessage", () => {
	it("should throw when context has no messages", () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		expect(() => agentLoopContinue(context, config)).toThrow("Cannot continue: no messages in context");
	});

	it("should continue from existing context without emitting user message events", async () => {
		const userMessage: AgentMessage = createUserMessage("Hello");

		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [userMessage],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoopContinue(context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		// Should only return the new assistant message (not the existing user message)
		expect(messages.length).toBe(1);
		expect(messages[0].role).toBe("assistant");

		// Should NOT have user message events (that's the key difference from agentLoop)
		const messageEndEvents = events.filter((e) => e.type === "message_end");
		expect(messageEndEvents.length).toBe(1);
		expect((messageEndEvents[0] as any).message.role).toBe("assistant");
	});

	it("should allow custom message types as last message (caller responsibility)", async () => {
		// Custom message that will be converted to user message by convertToLlm
		interface CustomMessage {
			role: "custom";
			text: string;
			timestamp: number;
		}

		const customMessage: CustomMessage = {
			role: "custom",
			text: "Hook content",
			timestamp: Date.now(),
		};

		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [customMessage as unknown as AgentMessage],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (messages) => {
				// Convert custom to user message
				return messages
					.map((m) => {
						if ((m as any).role === "custom") {
							return {
								role: "user" as const,
								content: (m as any).text,
								timestamp: m.timestamp,
							};
						}
						return m;
					})
					.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response to custom message" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		// Should not throw - the custom message will be converted to user message
		const stream = agentLoopContinue(context, config, undefined, streamFn);

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();
		expect(messages.length).toBe(1);
		expect(messages[0].role).toBe("assistant");
	});
});

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

	it("should return abort marker and remove partial message from context on onStreamText abort", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		let llmCallCount = 0;
		let contextMessagesAtSecondCall: AgentMessage[] = [];

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (msgs) => {
				llmCallCount++;
				if (llmCallCount === 2) {
					contextMessagesAtSecondCall = msgs.map((m) => ({ ...m }));
				}
				return identityConverter(msgs);
			},
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
				if (llmCallCount <= 1) {
					const partial1 = createAssistantMessage([{ type: "text", text: "This is " }]);
					const partial2 = createAssistantMessage([{ type: "text", text: "This is bad stuff" }]);
					stream.push({ type: "start", partial: partial1 });
					stream.push({ type: "text_start", contentIndex: 0, partial: partial1 });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "This is ", partial: partial1 });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "bad stuff", partial: partial2 });
					stream.push({ type: "text_end", contentIndex: 0, content: "This is bad stuff", partial: partial2 });
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

		const stream = agentLoop([createUserMessage("hi")], context, config, undefined, streamFn);
		for await (const _ of stream) {
			/* consume */
		}

		// Should have called LLM twice: first aborted, second succeeded
		expect(llmCallCount).toBe(2);

		// The partial "bad" assistant message should NOT be in context at the second call
		const assistantInSecondCall = contextMessagesAtSecondCall.filter((m) => m.role === "assistant");
		expect(assistantInSecondCall.length).toBe(0);
	});

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
				m.role === "user" && typeof m.content === "string" && m.content === "RULE: Do not use the word forbidden.",
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

		// Result should contain: user prompt, injected correction, and clean assistant response
		// (not the partial "bad" message)
		const assistantResults = messages.filter((m) => m.role === "assistant");
		expect(assistantResults.length).toBe(1);
		expect((assistantResults[0] as AssistantMessage).content[0]).toEqual({
			type: "text",
			text: "This is good",
		});

		// Agent should end normally
		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();
	});

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

		const streamFn: StreamFn = (_model, _ctx, options) => {
			const passedSignal = options?.signal as AbortSignal;

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
});
