# Plan Review Findings (2) — 001-core-types-stream-text-event

## 1. Coverage

- **AC1–AC5:** Covered by Task 1. The revised test correctly exercises basic type usage and discriminated-union narrowing.
- **AC6:** **Still not satisfied as written in the spec.**
  - Spec requires: `import { StreamTextEvent, StreamTextResult } from "@mariozechner/pi-agent"`.
  - Plan (correctly) references `@mariozechner/pi-agent-core` as the actual package name.
  - This is a spec/plan mismatch: either the spec’s AC6 must be corrected to `@mariozechner/pi-agent-core`, or the repo must introduce an `@mariozechner/pi-agent` package/alias (out of scope for this issue).

## 2. Ordering

- Single task; ordering is fine.

## 3. Completeness / Execution Risk

- The revised test now:
  - Uses **top-level imports** for `TextContent`/`ImageContent` (complies with repo rule).
  - Uses the **correct `ImageContent` shape** (`data` + `mimeType`).

- Minor improvement suggestion (optional):
  - If we want to better approximate “publicly accessible from the entrypoint”, change the test import to come from `../src/index.js` instead of `../src/types.js`. That verifies that `export * from "./types.js"` continues to expose the new types via the package entry module.

## Verdict: revise

The plan is implementable and now matches the codebase rules, but it cannot meet **AC6** until the spec’s import path is corrected (recommended) or a new package/alias is introduced (not recommended for this issue).
