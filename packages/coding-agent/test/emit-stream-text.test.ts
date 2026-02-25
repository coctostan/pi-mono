import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";

describe("ExtensionRunner.emitStreamText", () => {
	let tempDir: string;
	let extensionsDir: string;
	let emptyAgentDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stream-text-test-"));
		extensionsDir = path.join(tempDir, "ext-files");
		fs.mkdirSync(extensionsDir);
		emptyAgentDir = path.join(tempDir, "empty-agent");
		fs.mkdirSync(emptyAgentDir);
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns continue when no handlers are registered", async () => {
		const result = await discoverAndLoadExtensions([], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const streamResult = runner.emitStreamText({ chunk: "hello", accumulatedText: "hello" });
		expect(streamResult).toEqual({ action: "continue" });
	});

	it("returns continue when handler returns void", async () => {
		const extPath = path.join(extensionsDir, "noop.ts");
		fs.writeFileSync(
			extPath,
			`export default function(pi) {
				pi.on("stream_text", () => {});
			}`,
		);

		const result = await discoverAndLoadExtensions([extPath], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const streamResult = runner.emitStreamText({ chunk: "hello", accumulatedText: "hello" });
		expect(streamResult).toEqual({ action: "continue" });
	});

	it("returns continue when handler explicitly returns continue", async () => {
		const extPath = path.join(extensionsDir, "continue.ts");
		fs.writeFileSync(
			extPath,
			`export default function(pi) {
				pi.on("stream_text", () => ({ action: "continue" }));
			}`,
		);

		const result = await discoverAndLoadExtensions([extPath], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const streamResult = runner.emitStreamText({ chunk: "hello", accumulatedText: "hello" });
		expect(streamResult).toEqual({ action: "continue" });
	});

	it("returns abort when handler triggers abort", async () => {
		const extPath = path.join(extensionsDir, "abort.ts");
		fs.writeFileSync(
			extPath,
			`export default function(pi) {
				pi.on("stream_text", (event) => {
					if (event.accumulatedText.includes("bad")) {
						return { action: "abort", content: "Please do not say bad." };
					}
					return { action: "continue" };
				});
			}`,
		);

		const result = await discoverAndLoadExtensions([extPath], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const continueResult = runner.emitStreamText({ chunk: "good", accumulatedText: "good" });
		expect(continueResult).toEqual({ action: "continue" });

		const abortResult = runner.emitStreamText({
			chunk: "bad",
			accumulatedText: "this is bad",
		});
		expect(abortResult).toEqual({ action: "abort", content: "Please do not say bad." });
	});

	it("stops iterating after first abort (first abort wins)", async () => {
		const firstPath = path.join(extensionsDir, "first.ts");
		const secondPath = path.join(extensionsDir, "second.ts");
		fs.writeFileSync(
			firstPath,
			`export default function(pi) {
				pi.on("stream_text", () => ({ action: "abort", content: "First extension abort." }));
			}`,
		);
		fs.writeFileSync(
			secondPath,
			`export default function(pi) {
				pi.on("stream_text", () => ({ action: "abort", content: "Second extension abort." }));
			}`,
		);

		const result = await discoverAndLoadExtensions([firstPath, secondPath], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const streamResult = runner.emitStreamText({ chunk: "x", accumulatedText: "x" });
		expect(streamResult).toEqual({ action: "abort", content: "First extension abort." });
	});

	it("emits error and returns continue when handler throws", async () => {
		const extPath = path.join(extensionsDir, "throws.ts");
		fs.writeFileSync(
			extPath,
			`export default function(pi) {
				pi.on("stream_text", () => { throw new Error("handler exploded"); });
			}`,
		);

		const result = await discoverAndLoadExtensions([extPath], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
		runner.onError((err) => errors.push(err));

		const streamResult = runner.emitStreamText({ chunk: "x", accumulatedText: "x" });
		expect(streamResult).toEqual({ action: "continue" });
		expect(errors.length).toBe(1);
		expect(errors[0].error).toContain("handler exploded");
		expect(errors[0].event).toBe("stream_text");
	});

	it("emits error and returns continue when handler accidentally returns a Promise", async () => {
		const extPath = path.join(extensionsDir, "async-handler.ts");
		fs.writeFileSync(
			extPath,
			`export default function(pi) {
				pi.on("stream_text", async () => ({ action: "abort", content: "should not work" }));
			}`,
		);

		const result = await discoverAndLoadExtensions([extPath], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
		runner.onError((err) => errors.push(err));

		const streamResult = runner.emitStreamText({ chunk: "x", accumulatedText: "x" });
		expect(streamResult).toEqual({ action: "continue" });
		expect(errors.length).toBe(1);
		expect(errors[0].error).toContain("synchronous");
		expect(errors[0].event).toBe("stream_text");
	});

	it("ignores known async stream_text handlers on subsequent chunks", async () => {
		const extPath = path.join(extensionsDir, "async-once.ts");
		fs.writeFileSync(
			extPath,
			`export default function(pi) {
				pi.on("stream_text", async () => ({ action: "continue" }));
			}`,
		);

		const result = await discoverAndLoadExtensions([extPath], tempDir, emptyAgentDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
		runner.onError((err) => errors.push(err));

		runner.emitStreamText({ chunk: "a", accumulatedText: "a" });
		runner.emitStreamText({ chunk: "b", accumulatedText: "ab" });

		expect(errors.length).toBe(1);
		expect(errors[0].error).toContain("synchronous");
	});
});
