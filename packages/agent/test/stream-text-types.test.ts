import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { AgentLoopConfig, StreamTextEvent, StreamTextResult } from "../src/index.js";

describe("StreamTextEvent types", () => {
	it("StreamTextEvent has chunk and accumulatedText properties", () => {
		const event: StreamTextEvent = {
			chunk: "hello",
			accumulatedText: "hello world",
		};
		expect(event.chunk).toBe("hello");
		expect(event.accumulatedText).toBe("hello world");
	});

	it("StreamTextResult supports continue action", () => {
		const result: StreamTextResult = { action: "continue" };
		expect(result.action).toBe("continue");
	});

	it("StreamTextResult supports abort action with string content", () => {
		const result: StreamTextResult = {
			action: "abort",
			content: "You must not do that.",
		};
		expect(result.action).toBe("abort");
		if (result.action === "abort") {
			expect(result.content).toBe("You must not do that.");
		}
	});

	it("StreamTextResult supports abort action with structured content", () => {
		const result: StreamTextResult = {
			action: "abort",
			content: [
				{ type: "text", text: "Rule violated" } satisfies TextContent,
				{ type: "image", data: "AA==", mimeType: "image/png" } satisfies ImageContent,
			],
		};
		if (result.action === "abort") {
			expect(Array.isArray(result.content)).toBe(true);
		}
	});

	it("StreamTextResult discriminated union narrows correctly", () => {
		// Use a function return so TypeScript cannot narrow the union to a constant.
		const getResult = (): StreamTextResult => ({ action: "abort", content: "stop" });
		const result = getResult();
		if (result.action === "abort") {
			const _content: string | (TextContent | ImageContent)[] = result.content;
			expect(_content).toBe("stop");
		} else {
			const _action: "continue" = result.action;
			expect(_action).toBe("continue");
		}
	});

	it("AgentLoopConfig accepts onStreamText as optional", () => {
		const partialConfig: Pick<AgentLoopConfig, "onStreamText"> = {};
		expect(partialConfig.onStreamText).toBeUndefined();
	});

	it("AgentLoopConfig accepts onStreamText callback", () => {
		const callback = (event: StreamTextEvent): StreamTextResult => {
			if (event.accumulatedText.includes("bad")) {
				return { action: "abort", content: "Rule: no bad words" };
			}
			return { action: "continue" };
		};
		const partialConfig: Pick<AgentLoopConfig, "onStreamText"> = {
			onStreamText: callback,
		};
		expect(partialConfig.onStreamText).toBeDefined();

		const continueResult = callback({ chunk: "good", accumulatedText: "good" });
		expect(continueResult.action).toBe("continue");

		const abortResult = callback({ chunk: "bad", accumulatedText: "bad" });
		expect(abortResult.action).toBe("abort");
	});
});
