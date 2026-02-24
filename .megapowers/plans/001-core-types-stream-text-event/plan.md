## Plan: Add StreamTextEvent types and onStreamText callback

### Task 1: Add StreamTextEvent, StreamTextResult types and onStreamText to AgentLoopConfig

**Acceptance Criteria:** 1, 2, 3, 4, 5, 6

**Files:**
- Modify: `packages/agent/src/types.ts`
- Create: `packages/agent/test/stream-text-types.test.ts`

**Test:**

```typescript
import { describe, expect, it } from "vitest";
import type { TextContent, ImageContent } from "@mariozechner/pi-ai";
import type {
	StreamTextEvent,
	StreamTextResult,
	AgentLoopConfig,
} from "../src/index.js";

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
		const result: StreamTextResult = { action: "abort", content: "stop" };
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
```

**Implementation:**

In `packages/agent/src/types.ts`, add the following two type definitions after the `AgentLoopConfig` interface and before the `ThinkingLevel` type (around line 95):

```typescript
/**
 * Event passed to the onStreamText callback on each text chunk from the LLM.
 */
export interface StreamTextEvent {
	/** The current text delta from the LLM stream. */
	chunk: string;
	/** All text accumulated so far in this assistant response. */
	accumulatedText: string;
}

/**
 * Result returned by the onStreamText callback.
 * - "continue": keep streaming (no-op)
 * - "abort": stop the stream and provide content to inject as a rule message
 */
export type StreamTextResult =
	| { action: "continue" }
	| { action: "abort"; content: string | (TextContent | ImageContent)[] };
```

Add the following optional property to the `AgentLoopConfig` interface, after the `getFollowUpMessages` property:

```typescript
	/**
	 * Optional callback invoked on each text chunk during LLM streaming.
	 *
	 * Receives the current chunk and accumulated text. Returns either
	 * "continue" to keep streaming, or "abort" with content to inject
	 * as a correction message for retry.
	 *
	 * Synchronous — called on the hot path of every streamed token.
	 */
	onStreamText?: (event: StreamTextEvent) => StreamTextResult;
```

Note: `TextContent` and `ImageContent` are already imported from `@mariozechner/pi-ai` at the top of `types.ts`. No new imports needed.

AC6 is satisfied because `packages/agent/src/index.ts` already has `export * from "./types.js"`, which re-exports all named exports from `types.ts` through the package entrypoint (`@mariozechner/pi-agent-core`). The test imports from `../src/index.js` to verify this re-export path.

**Verify:**
```bash
cd packages/agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/stream-text-types.test.ts
```

Then from repo root:
```bash
npm run check
```
