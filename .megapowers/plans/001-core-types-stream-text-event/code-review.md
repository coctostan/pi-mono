# Plan Review Findings — 001-core-types-stream-text-event

## 1. Coverage

- **AC1–AC5:** Covered by Task 1 via additions to `packages/agent/src/types.ts` and type-usage tests in `packages/agent/test/stream-text-types.test.ts`.
- **AC6 (public import path):** **Gap / mismatch.** Spec says `import { ... } from "@mariozechner/pi-agent"`, but this repo’s package name is `@mariozechner/pi-agent-core` (see `packages/agent/package.json`). There is no `tsconfig` path alias for `@mariozechner/pi-agent`. As written, the plan cannot truly verify AC6.

## 2. Ordering

- Single task; no dependency/order issues.

## 3. Completeness / Execution Risk

### Task 1 issues

1. **Violates repo rule: “NEVER use inline imports”**
   - The plan’s test uses `import("@mariozechner/pi-ai").TextContent` in a type position.
   - Fix: add top-level `import type { TextContent, ImageContent } from "@mariozechner/pi-ai";` and reference those types directly.

2. **Incorrect `ImageContent` shape in test**
   - Test uses `{ type: "image", source: { type: "url", url: ... } }`.
   - Actual `ImageContent` is `{ type: "image", data: string; mimeType: string }` (see `packages/ai/src/types.ts`).
   - Fix: use e.g. `{ type: "image", data: "AA==", mimeType: "image/png" }`.

3. **AC6 import path should be clarified**
   - Recommended: update spec/plan to assert public export via `@mariozechner/pi-agent-core` (the actual package), or change criterion to “exported from package entrypoint (`src/index.ts`)” and verify via `import type { StreamTextEvent } from "../src/index.js"`.

## Verdict: revise

The approach is correct and close, but Task 1’s test code needs adjustments (inline import rule + `ImageContent` shape), and AC6/spec import path likely needs correction to match the actual package name.
