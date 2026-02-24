## Findings

### Critical
None

### Important
1. **Out-of-scope runtime changes are included in this issue’s diff**.
   - Spec explicitly says this is a **types-only** change in `packages/agent/src/types.ts`.
   - Branch diff from merge-base includes an additional runtime data file:
     - `packages/ai/src/models.generated.ts`
   - Evidence:
     - `git diff --name-only <merge-base>..HEAD -- packages` shows:
       - `packages/agent/src/types.ts`
       - `packages/agent/test/stream-text-types.test.ts`
       - `packages/ai/src/models.generated.ts`
     - `git diff <merge-base>..HEAD -- packages/ai/src/models.generated.ts` shows multiple model catalog changes (e.g., hunks at `@@ -5882`, `@@ -6845`, `@@ -9497`, `@@ -9990`, `@@ -10026`).
   - Why this matters: these are unrelated behavioral/data changes and increase merge risk for issue `001-core-types-stream-text-event`.
   - Required action: remove/split `packages/ai/src/models.generated.ts` changes from this issue before merge.

### Minor
1. `packages/agent/test/stream-text-types.test.ts` includes a discriminated-union narrowing test that relies mostly on assignment checks inside runtime branches (`lines 44-52`).
   - This works, but a dedicated type assertion helper (e.g., `expectTypeOf`) would make intent clearer for future maintainers.

## Assessment
needs-rework

The agent types implementation itself is clean and aligned with the spec (`packages/agent/src/types.ts`). However, the overall change set is not review-ready for merge because it includes unrelated changes in `packages/ai/src/models.generated.ts`, which violates the issue scope (types-only). Recommend returning to implement phase to isolate/split the diff, then re-review.
