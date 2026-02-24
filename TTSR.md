# TTSR: Time Traveling Streamed Rules

A pi-agent-core patch + extension that enables zero-context-cost rule enforcement by intercepting the LLM's output stream mid-generation.

## Concept

Rules define regex triggers that watch the model's output as it streams. When a pattern matches, generation aborts, the rule injects as a system message, and the request retries. The model never sees its own aborted output. Each rule fires at most once per session.

**Zero upfront context cost.** A rule like "don't use deprecated API X" consumes no tokens until the model actually starts writing code that uses API X. Compare to stuffing all rules in the system prompt, where every rule costs tokens on every turn regardless of relevance.

## Architecture

Two components:

1. **pi-agent-core patch**: Adds an `onStreamText` callback to the agent loop (~75 lines across 4 files)
2. **pi-ttsr extension**: Loads rules, registers the callback, manages one-shot firing state

### Part 1: pi-agent-core Patch

#### Files to modify

**`packages/agent/src/types.ts`**

Add to `AgentLoopConfig`:

```typescript
/**
 * Called on each text chunk during LLM response streaming.
 * Return { abort: true, retry: { inject } } to cancel the current
 * generation, discard the partial response, inject a system message,
 * and retry the turn.
 */
onStreamText?: (event: StreamTextEvent) => StreamTextResult | undefined;
```

New types:

```typescript
export interface StreamTextEvent {
  /** The text chunk just received */
  chunk: string;
  /** Full accumulated text of the current response so far */
  accumulated: string;
}

export interface StreamTextResult {
  /** If true, abort the current generation */
  abort: boolean;
  /** If aborting, inject this content as a system message before retrying */
  retry?: {
    /** Message content to inject */
    content: string;
    /** Role for the injected message. Default: "system" */
    role?: "system" | "user";
  };
}
```

**`packages/agent/src/agent-loop.ts`**

In `streamAssistantResponse()`, modify the `text_delta` case:

```typescript
// Current code (line ~252):
case "text_delta":
    // updates partialMessage, pushes to event stream
    break;

// New code:
case "text_delta": {
    // existing partial message update logic...

    // TTSR hook
    if (config.onStreamText) {
        accumulatedText += event.text;  // new variable, initialized to "" at function start
        const result = config.onStreamText({
            chunk: event.text,
            accumulated: accumulatedText,
        });
        if (result?.abort) {
            // Store the retry instruction for the caller
            streamAbortReason = result.retry;  // new variable
            // Abort the stream
            abortController.abort();
            break;
        }
    }
    break;
}
```

After the streaming loop completes, check for abort:

```typescript
// After the for-await loop over stream events:
if (streamAbortReason) {
    // Remove the partial assistant message from context
    // (it was already pushed via addedPartial — pop it)
    if (addedPartial) {
        messages.pop();
    }
    // Return a sentinel that tells runLoop to inject and retry
    return {
        type: "ttsr_abort",
        inject: streamAbortReason,
    };
}
```

**`packages/agent/src/agent-loop.ts`** (in `runLoop`)

Handle the TTSR abort return from `streamAssistantResponse`:

```typescript
// In the main loop, after calling streamAssistantResponse:
if (streamResult?.type === "ttsr_abort") {
    // Inject the rule as a pending message
    const injectMsg = {
        role: streamResult.inject.role ?? "system",
        content: streamResult.inject.content,
    };
    // Add to pending messages (same mechanism as steering)
    pendingMessages.push(injectMsg);
    // Continue the loop — next iteration will include the injected message
    continue;
}
```

**`packages/coding-agent/src/core/extensions/types.ts`**

Add the extension event:

```typescript
export interface StreamTextEvent {
    chunk: string;
    accumulated: string;
}

export interface StreamTextEventResult {
    abort?: boolean;
    retry?: {
        content: string;
        role?: "system" | "user";
    };
}

// Add to the on() overloads:
on(event: "stream_text", handler: ExtensionHandler<StreamTextEvent, StreamTextEventResult>): void;
```

**`packages/coding-agent/src/core/agent-session.ts`**

Wire the extension event to the agent loop config:

```typescript
// In the agent loop config construction:
onStreamText: (event) => {
    return this._extensionRunner?.emit("stream_text", event);
},
```

#### Impact when unused

Zero. The `onStreamText` callback is optional. When no extension registers for `stream_text`, the callback is undefined and the hot path has one nullish check per text chunk. No allocation, no function call.

#### Testing

- Unit test: mock stream that emits text chunks, verify abort halts stream
- Unit test: verify partial message is removed from context on abort
- Unit test: verify injected message appears in next turn
- Unit test: verify no-op when callback is undefined
- Integration test: rule that triggers on a known pattern, verify the model retries with the rule injected

---

### Part 2: pi-ttsr Extension

#### Rule format

Rules live in `.pi/rules/` or `~/.pi/rules/` as markdown files with frontmatter:

```markdown
---
trigger: "import.*from ['\"]deprecated-module['\"]"
flags: "i"
scope: "line"
---

RULE: Never import from `deprecated-module`. It was removed in v3.
Use `@new-module/core` instead. The API is identical except:
- `createClient()` is now `initClient()`
- `config.timeout` moved to `config.options.timeout`
```

Frontmatter fields:

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `trigger` | `string` | Yes | — | Regex pattern to match against the stream |
| `flags` | `string` | No | `""` | Regex flags (e.g. `"i"` for case-insensitive) |
| `scope` | `"line" \| "chunk" \| "accumulated"` | No | `"line"` | What to match against: individual lines of accumulated text, each raw chunk, or the full accumulated response |
| `maxFirings` | `number` | No | `1` | How many times this rule can fire per session. After reaching the limit, the rule goes dormant. |
| `cooldown` | `number` | No | `0` | Minimum seconds between firings (if maxFirings > 1) |

The markdown body (after frontmatter) is the rule content that gets injected on match.

#### Extension structure

```
pi-ttsr/
  package.json
  extensions/
    ttsr/
      index.ts        # session_start: load rules; stream_text: match and abort
      loader.ts       # discover and parse rule files from .pi/rules/ and ~/.pi/rules/
      matcher.ts      # regex matching against stream, scope handling
      state.ts        # per-rule firing count, cooldown tracking
  README.md
```

#### Core logic

```typescript
// index.ts (simplified)

interface TtsrRule {
  name: string;
  trigger: RegExp;
  scope: "line" | "chunk" | "accumulated";
  content: string;
  maxFirings: number;
  cooldown: number;
}

interface RuleState {
  firings: number;
  lastFired: number;
}

export default function ttsr(pi: ExtensionAPI) {
  let rules: TtsrRule[] = [];
  const state = new Map<string, RuleState>();

  pi.on("session_start", async () => {
    rules = await loadRules();  // scan .pi/rules/ and ~/.pi/rules/
    state.clear();
  });

  pi.on("stream_text", ({ chunk, accumulated }) => {
    for (const rule of rules) {
      const ruleState = state.get(rule.name) ?? { firings: 0, lastFired: 0 };

      // Check firing limits
      if (ruleState.firings >= rule.maxFirings) continue;
      if (rule.cooldown > 0 && Date.now() - ruleState.lastFired < rule.cooldown * 1000) continue;

      // Check match
      let matched = false;
      if (rule.scope === "chunk") {
        matched = rule.trigger.test(chunk);
      } else if (rule.scope === "accumulated") {
        matched = rule.trigger.test(accumulated);
      } else {
        // "line" scope: check each line of accumulated text
        const lines = accumulated.split("\n");
        matched = lines.some(line => rule.trigger.test(line));
      }

      if (matched) {
        ruleState.firings++;
        ruleState.lastFired = Date.now();
        state.set(rule.name, ruleState);

        return {
          abort: true,
          retry: {
            content: `[TTSR RULE: ${rule.name}]\n\n${rule.content}\n\nYour previous response was interrupted because it matched this rule. Regenerate your response following the rule above.`,
          },
        };
      }
    }
    return undefined;
  });
}
```

#### Scope behavior

- **`line`** (default): Splits accumulated text by newlines, tests each line. Best for catching specific code patterns like imports, type annotations, function signatures. Most common use case.
- **`chunk`**: Tests each raw chunk as it arrives. Useful for catching short patterns that might span line boundaries. Cheapest — no split operation.
- **`accumulated`**: Tests the full accumulated response. Useful for multi-line patterns or contextual rules ("if the response contains X but not Y"). Most expensive — runs the full regex on growing text each chunk. Use sparingly.

#### Performance

The hot path is one loop over rules per text chunk. With typical rule counts (5-20 rules), this is microseconds. The regex tests are the cost. Recommendations:
- Keep triggers simple (literal strings with minimal wildcards)
- Use `line` scope (splits are cheap, tested strings are short)
- Avoid `accumulated` scope with complex regexes on long responses

#### Example rules

**No deprecated imports:**
```markdown
---
trigger: "from ['\"]@old-sdk/"
---
Do not import from `@old-sdk/*`. Use `@new-sdk/*` instead.
See migration guide: docs/migration-v3.md
```

**No `any` types in TypeScript:**
```markdown
---
trigger: ":\\s*any[\\s;,)\\]]"
---
Do not use the `any` type. Use proper type annotations.
If the type is genuinely unknown, use `unknown` and narrow with type guards.
```

**No console.log in production code:**
```markdown
---
trigger: "console\\.(log|debug|info)\\("
scope: "line"
---
Do not use console.log/debug/info in production code.
Use the project's logger: `import { log } from '@app/logger'`.
```

**No hardcoded secrets:**
```markdown
---
trigger: "(api[_-]?key|secret|password|token)\\s*[=:]\\s*['\"][^'\"]{8,}"
flags: "i"
---
Never hardcode secrets, API keys, passwords, or tokens.
Use environment variables: `process.env.API_KEY`.
```

## Applying the Patch

Until/unless this lands as an upstream PR, maintain it as a local patch:

```bash
# From your pi-mono fork
git checkout -b ttsr-hook
# Apply the ~75 line changes to the 4 files
# Test
npm run check
./test.sh
git commit -m "feat(agent): add onStreamText callback for mid-stream extension hooks"
```

The extension (`pi-ttsr`) is a separate repo/package that depends on the patched pi-agent-core. It works as a normal `pi install` package — the only requirement is running on the patched pi.

## Upstream PR Strategy

When issues reopen (March 2):

1. Open issue: "Add optional `onStreamText` callback to agent loop for mid-stream extension hooks"
2. Pitch: Hook point, not feature. Same pattern as `tool_call`/`tool_result`/`before_agent_start`. Zero impact when unused. Enables guardrail extensions that currently require post-hoc retry loops.
3. Don't mention TTSR by name — it's an implementation detail. The hook is general-purpose.
4. If `lgtm`: submit the PR from the existing branch. It's already written and tested.
