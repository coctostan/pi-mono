import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.js";
import { SessionManager } from "../src/core/session-manager.js";

describe("sdk.ts stream_text wiring", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sdk-stream-text-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("agent.onStreamText is set and returns continue when no runner is available", async () => {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});

		// onStreamText should be set by sdk.ts even without extensions
		expect(session.agent.onStreamText).toBeDefined();
		const result = session.agent.onStreamText!({ chunk: "test", accumulatedText: "test" });
		expect(result).toEqual({ action: "continue" });
	});
});
