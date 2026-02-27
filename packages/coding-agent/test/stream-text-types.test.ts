import { describe, expect, it } from "vitest";
import type {
	StreamTextExtensionEvent,
	StreamTextExtensionEventResult,
	SyncExtensionHandler,
} from "../src/core/extensions/types.js";

describe("stream_text extension types", () => {
	it("StreamTextExtensionEvent has chunk and accumulatedText fields", () => {
		const event: StreamTextExtensionEvent = {
			chunk: "hello",
			accumulatedText: "hello world",
		};
		expect(event.chunk).toBe("hello");
		expect(event.accumulatedText).toBe("hello world");
	});

	it("StreamTextExtensionEventResult supports continue action", () => {
		const result: StreamTextExtensionEventResult = { action: "continue" };
		expect(result.action).toBe("continue");
	});

	it("StreamTextExtensionEventResult supports abort action with string content", () => {
		const result: StreamTextExtensionEventResult = {
			action: "abort",
			content: "Please follow the rules.",
		};
		expect(result.action).toBe("abort");
	});

	it("SyncExtensionHandler allows sync return", () => {
		const handler: SyncExtensionHandler<StreamTextExtensionEvent, StreamTextExtensionEventResult> = (
			_event,
			_ctx,
		) => {
			return { action: "continue" };
		};
		expect(typeof handler).toBe("function");
	});

	it("SyncExtensionHandler allows void return", () => {
		const handler: SyncExtensionHandler<StreamTextExtensionEvent, StreamTextExtensionEventResult> = () => {
			// no return
		};
		expect(typeof handler).toBe("function");
	});

	it("SyncExtensionHandler rejects async handlers at compile time", () => {
		// @ts-expect-error — SyncExtensionHandler must not accept Promise returns
		const _handler: SyncExtensionHandler<StreamTextExtensionEvent, StreamTextExtensionEventResult> = async (
			_event,
			_ctx,
		) => {
			return { action: "continue" as const };
		};
	});
});
