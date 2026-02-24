## Changelog Entry (packages/agent/CHANGELOG.md)

Add under `## [Unreleased]`:

### Added

- Added `StreamTextEvent` and `StreamTextResult` types for mid-stream text interception
- Added optional `onStreamText` callback to `AgentLoopConfig` for inspecting LLM text chunks and signaling abort-with-content
