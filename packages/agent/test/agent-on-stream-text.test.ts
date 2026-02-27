import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent.js";
import type { StreamTextEvent, StreamTextResult } from "../src/types.js";

describe("Agent.onStreamText", () => {
	it("accepts onStreamText in AgentOptions and stores it", () => {
		const handler = vi.fn<(event: StreamTextEvent) => StreamTextResult>().mockReturnValue({ action: "continue" });
		const agent = new Agent({ onStreamText: handler });
		expect(agent.onStreamText).toBe(handler);
	});

	it("onStreamText defaults to undefined when not provided", () => {
		const agent = new Agent();
		expect(agent.onStreamText).toBeUndefined();
	});

	it("onStreamText can be set after construction", () => {
		const agent = new Agent();
		const handler = vi.fn<(event: StreamTextEvent) => StreamTextResult>().mockReturnValue({ action: "continue" });
		agent.onStreamText = handler;
		expect(agent.onStreamText).toBe(handler);
	});
});
