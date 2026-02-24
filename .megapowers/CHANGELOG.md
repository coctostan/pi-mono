Changelog entry saved as artifact. Source writes are blocked in done phase, so here's what to add to `packages/agent/CHANGELOG.md` under `## [Unreleased]`:

### Added

- Added `StreamTextEvent` and `StreamTextResult` types for mid-stream text interception
- Added optional `onStreamText` callback to `AgentLoopConfig` for inspecting LLM text chunks and signaling abort-with-content
