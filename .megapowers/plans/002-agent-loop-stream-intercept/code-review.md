# Plan Review — 002-agent-loop-stream-intercept

## Coverage
All acceptance criteria (AC1–AC11) are addressed by at least one task.

Notes:
- AC3/AC11 (abort via child signal + distinct return type) is covered in Task 1/3/4, but the current tests do not make the abort path deterministic (see Completeness).

## Ordering
Ordering has a dependency bug:
- **Task 3 requires Task 4** (retry/injection logic) to pass, because Task 3 asserts two LLM calls (abort + retry). As written it only depends on Task 1.
  - Fix: either move Task 4 before Task 3, or change Task 3 to only test `streamAssistantResponse` returning an abort marker + partial message removal (no retry expectation).

## Completeness
Several items prevent the plan from being directly executable TDD-style:

1. **Missing explicit import edits in tests**
   - Tests introduce new types (`StreamTextEvent`, and in Task 4 `Message`) but the plan doesn’t specify updating the import list in:
     - `packages/agent/test/agent-loop.test.ts`

2. **Ellipses / placeholders violate “complete code” rule**
   - Task 1 implementation includes `// ... existing preamble ...` and similar placeholders. Tasks must include fully pasteable code blocks for modified functions.

3. **`any` usage in tests**
   - Multiple tests type streamFn params as `any`. Repo rules discourage `any`. Use `unknown` (and narrow) or the actual types.

4. **Abort path is not deterministic with `MockAssistantStream`**
   - Task 1 implementation assumes `childController.abort()` causes the async iterator to terminate immediately (“stream erroring”). The current mock stream does **not** automatically terminate on abort signals, so tests for abort behavior may be flaky or fail.
   - Recommended fix:
     - Make `streamAssistantResponse` **return immediately** when `onStreamText` returns `{ action: "abort" }` (after removing the partial assistant message), rather than waiting for the stream to end.
     - Adjust tests to match the immediate-return semantics.

## Verdict: revise
The approach is sound, but the plan should be revised to:
1. Fix Task 3 dependency (Task 4 must come first, or Task 3 must be re-scoped).
2. Make the abort behavior deterministic (prefer immediate return on abort).
3. Add explicit import-change instructions for the test file.
4. Remove `any` in tests.
5. Replace placeholders with complete pasteable code.
