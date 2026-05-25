# scry v2 — Plan B: Engine pivot to Claude Agent SDK

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace scry's custom engine (`planner` + `mcp-pool` + `normalizer` + `synthesizer`) with `@anthropic-ai/claude-agent-sdk`. By the end, `scry "<query>"` runs the same kind of search but flows through Claude's agent loop. Same registry, same MCPs, smarter routing.

**Architecture:** New `src/engine/` module wraps the SDK's `query()` async iterable behind a `runQuery(options)` entry point that emits typed events. `src/cli.ts` splits into a directory; the headless query path now calls `runQuery` and prints events to stdout. Old `src/core/*` engine deleted.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` (TS, in-process, manages stdio MCPs), existing config + dotenv loaders kept as-is.

**Spec reference:** [`docs/superpowers/specs/2026-05-22-scry-web-frontend-v2-design.md`](../specs/2026-05-22-scry-web-frontend-v2-design.md) — Engine module + Architecture sections.

**Branch state at start:** `main` after Plan A merged. CLI's `scry "<query>"` still uses the old engine. `scry serve` boots the empty SPA. Tests: 190 passing.

**Out of scope (later plans):** Storage / SQLite (folded into Plan C when first needed), search route + UI (Plan C), library sidebar (Plan D), MCP/registry/onboarding/preferences UI (Plans E–H).

---

## File map

| Path | Purpose |
|---|---|
| `src/engine/types.ts` | `RunQueryOptions`, `RunQueryEvent`, `SourceCard`, `Citation` |
| `src/engine/system-prompt.ts` | Pure function: `(registry, fanoutMode) → string` |
| `src/engine/source-tracker.ts` | Session-scoped `[N]` assignment + marker validation |
| `src/engine/runQuery.ts` | Wraps Agent SDK `query()`; emits typed events; injectable `queryFn` for tests |
| `src/cli/index.ts` | Commander setup; dispatches to subcommand modules |
| `src/cli/headless.ts` | `scry "<query>"` action → calls `runQuery`, prints events to stdout |
| `src/cli/serve.ts` | `scry serve` action (lifted from current `cli.ts`) |
| `src/cli/config-show.ts` | `config show` action (lifted) |
| `src/cli/init.ts` | Re-exports the existing `runInit` (no behavior change) |
| `src/cli.ts` | Becomes a 2-line entry: `import './cli/index.js'` |
| **DELETED** | `src/core/{planner,mcp-pool,normalizer,synthesizer,registry,detector}.ts` and their tests |
| `package.json` | `+@anthropic-ai/claude-agent-sdk`, `-@anthropic-ai/sdk` |

---

### Task 1: Branch + dependency swap + verify SDK shape

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Branch + install/uninstall**

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feat/engine-pivot
npm install @anthropic-ai/claude-agent-sdk
npm uninstall @anthropic-ai/sdk
```

- [ ] **Step 2: Verify the SDK's actual API shape — read its types now, before any engine code is written**

```bash
ls node_modules/@anthropic-ai/claude-agent-sdk/
cat node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts | head -400
```

Look for:
1. The `query()` function signature — what does its `options` param accept? Confirm `cwd`, `systemPrompt`, `mcpServers`, `resume`, `abortController` are all there as the spec assumes.
2. The async-iterable element type (the SDK's "message" union). Note the literal `type` discriminators — common conventions:
   - `system` / `system.init` (carries `session_id`)
   - `assistant` (with a `message.content[]` array of `text` and `tool_use` blocks)
   - `user` (with a `message.content[]` array of `tool_result` blocks)
   - `result` (final completion message)
   The plan's T5 implementation and test fixtures dispatch on these. **If the real names differ, both must be updated together when T5 lands.** Capture what you saw in a comment block at the top of `runQuery.ts` (T5 step 1 reminds you to do this).
3. Whether `mcpServers` accepts the shape `{ name: { command, args, env } }` or a richer shape (e.g. transport variants). The plan's `buildMcpServers` helper assumes the simple form.

If the SDK's API differs materially from what this plan assumes (e.g. no `mcpServers` option, or `query()` is class-based instead of a function returning an async iterable), **STOP and report** — the plan needs adjustment before any further task can proceed.

- [ ] **Step 3: Verify build still works (engine still uses old code at this point)**

```bash
npm run build 2>&1 | tail -3
```

If `@anthropic-ai/sdk` was directly imported by `src/core/synthesizer.ts`, it'll fail. The synthesizer uses raw `fetch()` (no SDK import), so the removal should not break the build. If it does, **STOP and report**.

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -3
```

Expected: same count as `main` (190).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @anthropic-ai/claude-agent-sdk; drop @anthropic-ai/sdk"
```

---

### Task 2: `src/engine/types.ts`

**Files:** Create `src/engine/types.ts`

- [ ] **Step 1: Implement**

```typescript
// src/engine/types.ts
import type { ScryConfig } from '../config/types.js';

export interface SourceCard {
  index: number;        // 1-based, stable across follow-up turns
  source: string;       // server name (e.g. 'slack')
  tool: string;         // tool name (e.g. 'slack_search')
  title: string;
  snippet: string;
  url?: string;
  author?: string;
  timestamp?: string;
  raw: unknown;         // original tool_result content
}

export interface Citation {
  index: number;
  source: string;
  title: string;
  url?: string;
  author?: string;
  timestamp?: string;
}

export interface RunQueryOptions {
  prompt: string;
  config: ScryConfig;
  scryConfigDir: string;       // absolute path; passed as Options.cwd to the SDK
  signal?: AbortSignal;
  resume?: string;             // SDK session_id from a prior turn
  fanoutMode?: boolean;        // adds a system-prompt directive
  priorSources?: SourceCard[]; // session's prior sources for follow-up turns
}

export type RunQueryEvent =
  | { type: 'session-init'; sessionId: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; sourceIndex: number; source: SourceCard }
  | { type: 'assistant-text'; text: string }
  | { type: 'citation'; index: number; source: SourceCard }
  | { type: 'done'; sessionId: string; sources: SourceCard[]; finalAnswer: string }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Build + commit**

```bash
npm run build 2>&1 | tail -3
git add src/engine/types.ts
git commit -m "feat(engine): types for RunQuery, SourceCard, Citation"
```

---

### Task 3: `src/engine/system-prompt.ts` (TDD)

**Files:** Create `src/engine/system-prompt.ts`, `tests/engine/system-prompt.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/engine/system-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/engine/system-prompt.js';
import type { Registry } from '../../src/config/types.js';

const empty: Registry = { people: {}, projects: {} };

describe('buildSystemPrompt', () => {
  it('always includes scry identity and citation rules', () => {
    const p = buildSystemPrompt({ registry: empty, fanoutMode: false });
    expect(p).toMatch(/scry/i);
    expect(p).toMatch(/\[1\]/);
    expect(p).toMatch(/cite/i);
  });

  it('includes registry as JSON when populated', () => {
    const registry: Registry = {
      people: { aviralv: { name: 'Aviral Vaid', identifiers: { email: 'av@example.com' } } },
      projects: { eca: { name: 'ECA', aliases: ['eca-platform'], routing: { slack_channels: ['team-eca'] } } },
    };
    const p = buildSystemPrompt({ registry, fanoutMode: false });
    expect(p).toContain('Aviral Vaid');
    expect(p).toContain('ECA');
    expect(p).toContain('team-eca');
  });

  it('adds fanout directive when fanoutMode is true', () => {
    const p = buildSystemPrompt({ registry: empty, fanoutMode: true });
    expect(p).toMatch(/all.*configured.*tools|every.*search.*source|exhaustive|fanout/i);
  });

  it('omits fanout directive when fanoutMode is false', () => {
    const p = buildSystemPrompt({ registry: empty, fanoutMode: false });
    expect(p).not.toMatch(/fanout mode/i);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- tests/engine/system-prompt.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/engine/system-prompt.ts
import type { Registry } from '../config/types.js';

interface BuildSystemPromptOptions {
  registry: Registry;
  fanoutMode: boolean;
}

const IDENTITY = `You are scry, a federated search assistant.
You answer the user's question by calling the configured search tools (Slack, Confluence, Jira, email, etc.) and synthesizing the results.`;

const OUTPUT_RULES = `Output rules:
- Cite sources inline as [1], [2], etc. — one citation per claim.
- If a tool returns no relevant results, say so explicitly rather than inventing content.
- If two sources disagree, surface the disagreement.
- Prioritize recent results when timestamps are available.
- Keep the answer under 200 words unless the question demands more.`;

const FANOUT_DIRECTIVE = `Search-mode override: the user has activated fanout mode. Call ALL configured search tools in your first turn before producing any prose, then synthesize across the combined results.`;

export function buildSystemPrompt(opts: BuildSystemPromptOptions): string {
  const sections: string[] = [IDENTITY];

  const hasRegistry =
    Object.keys(opts.registry.people ?? {}).length > 0 ||
    Object.keys(opts.registry.projects ?? {}).length > 0;
  if (hasRegistry) {
    sections.push(`Context (registry):\n${JSON.stringify(opts.registry, null, 2)}`);
  }

  sections.push(OUTPUT_RULES);

  if (opts.fanoutMode) {
    sections.push(FANOUT_DIRECTIVE);
  }

  return sections.join('\n\n');
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npm test -- tests/engine/system-prompt.test.ts
git add src/engine/system-prompt.ts tests/engine/system-prompt.test.ts
git commit -m "feat(engine): system-prompt composer (registry + rules + fanout)"
```

---

### Task 4: `src/engine/source-tracker.ts` (TDD)

**Files:** Create `src/engine/source-tracker.ts`, `tests/engine/source-tracker.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/engine/source-tracker.test.ts
import { describe, it, expect } from 'vitest';
import { SourceTracker } from '../../src/engine/source-tracker.js';
import type { SourceCard } from '../../src/engine/types.js';

describe('SourceTracker', () => {
  it('starts empty when no priors given', () => {
    const t = new SourceTracker([]);
    expect(t.sources).toEqual([]);
  });

  it('assigns [1], [2], [3] in arrival order', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    t.recordToolResult('confluence-jira', 'confluence_search', { title: 'B', snippet: 'b' });
    t.recordToolResult('slack', 'slack_search', { title: 'C', snippet: 'c' });
    expect(t.sources.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(t.sources.map((s) => s.title)).toEqual(['A', 'B', 'C']);
  });

  it('continues numbering across follow-up turns when priors passed', () => {
    const prior: SourceCard[] = [
      { index: 1, source: 'slack', tool: 'slack_search', title: 'A', snippet: 'a', raw: {} },
      { index: 2, source: 'confluence-jira', tool: 'confluence_search', title: 'B', snippet: 'b', raw: {} },
    ];
    const t = new SourceTracker(prior);
    t.recordToolResult('slack', 'slack_search', { title: 'C', snippet: 'c' });
    expect(t.sources.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('validateMarkers returns citations for known indices', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    t.recordToolResult('slack', 'slack_search', { title: 'B', snippet: 'b' });
    const cits = t.validateMarkers('Andre said X [1] but Dimitri disagreed [2]');
    expect(cits.map((c) => c.index)).toEqual([1, 2]);
  });

  it('drops unmapped indices', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    expect(t.validateMarkers('claim [99]')).toEqual([]);
  });

  it('deduplicates repeated indices in one text', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    const cits = t.validateMarkers('says [1] and again [1]');
    expect(cits.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- tests/engine/source-tracker.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/engine/source-tracker.ts
import type { Citation, SourceCard } from './types.js';

interface ToolResultPayload {
  title: string;
  snippet: string;
  url?: string;
  author?: string;
  timestamp?: string;
  raw?: unknown;
}

export class SourceTracker {
  private list: SourceCard[];

  constructor(prior: SourceCard[]) {
    this.list = [...prior];
  }

  get sources(): SourceCard[] {
    return [...this.list];
  }

  recordToolResult(server: string, tool: string, payload: ToolResultPayload): SourceCard {
    const card: SourceCard = {
      index: this.list.length + 1,
      source: server,
      tool,
      title: payload.title,
      snippet: payload.snippet,
      url: payload.url,
      author: payload.author,
      timestamp: payload.timestamp,
      raw: payload.raw ?? null,
    };
    this.list.push(card);
    return card;
  }

  validateMarkers(text: string): Citation[] {
    const seen = new Set<number>();
    const cites: Citation[] = [];
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const idx = Number(m[1]);
      if (seen.has(idx)) continue;
      const card = this.list.find((s) => s.index === idx);
      if (!card) continue;
      seen.add(idx);
      cites.push({
        index: idx,
        source: card.source,
        title: card.title,
        url: card.url,
        author: card.author,
        timestamp: card.timestamp,
      });
    }
    return cites;
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
npm test -- tests/engine/source-tracker.test.ts
git add src/engine/source-tracker.ts tests/engine/source-tracker.test.ts
git commit -m "feat(engine): session-scoped SourceTracker with [N] validation"
```

---

### Task 5: `src/engine/runQuery.ts` (TDD with injected query function)

**The most involved task.** The implementer should **first read the SDK's type definitions** to know the exact message shape before writing code. The dispatch in runQuery.ts must match the real SDK type names — don't invent.

**Files:** Create `src/engine/runQuery.ts`, `tests/engine/runQuery.test.ts`

- [ ] **Step 1: Read the SDK types**

```bash
ls node_modules/@anthropic-ai/claude-agent-sdk/
cat node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts | head -300
```

Look for the union type yielded by `query()`. Common variants you should expect to dispatch on:
- A `system` / `system.init` message with `session_id`
- An `assistant` message with `message.content` array containing `text` and `tool_use` blocks
- A `user` message with `tool_result` blocks
- A `result` message marking completion

Document in a top-of-file comment in `runQuery.ts` which message type names you saw and the dispatch keys you used.

- [ ] **Step 2: Write tests** (uses dependency injection — pass a fake `queryFn`)

```typescript
// tests/engine/runQuery.test.ts
import { describe, it, expect } from 'vitest';
import { runQuery } from '../../src/engine/runQuery.js';
import type { ScryConfig } from '../../src/config/types.js';
import type { RunQueryEvent } from '../../src/engine/types.js';

const baseConfig: ScryConfig = {
  llm: { base_url: 'http://x', auth_token: 't', model: 'claude-haiku' },
  mcp_servers: { slack: { command: 'slack-mcp' } },
  search_tools: { slack: [{ tool: 'slack_search', params: {} }] },
  registry: { people: {}, projects: {} },
};

async function collect(stream: AsyncIterable<RunQueryEvent>): Promise<RunQueryEvent[]> {
  const events: RunQueryEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

describe('runQuery', () => {
  it('emits session-init then assistant-text then done for a simple stream', async () => {
    // Adapt these fixtures to match the REAL SDK type shapes from Step 1.
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } };
      yield { type: 'result', subtype: 'success', session_id: 'sess-1' };
    };

    const events = await collect(
      runQuery({
        prompt: 'hi',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );

    expect(events[0]).toMatchObject({ type: 'session-init', sessionId: 'sess-1' });
    expect(events.some((e) => e.type === 'assistant-text' && e.text === 'Hello')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', sessionId: 'sess-1' });
  });

  it('records tool_results and emits citations on [N] markers', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-2' };
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'slack_search', input: { query: 'andre' } }],
        },
      };
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: JSON.stringify([{ title: 'A msg', snippet: 'andre said x', author: 'andre' }]),
            },
          ],
        },
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Andre said X [1]' }] },
      };
      yield { type: 'result', subtype: 'success', session_id: 'sess-2' };
    };

    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );

    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toBeDefined();
    if (toolResult && toolResult.type === 'tool-result') {
      expect(toolResult.sourceIndex).toBe(1);
      expect(toolResult.tool).toBe('slack_search');
    }

    const citation = events.find((e) => e.type === 'citation');
    expect(citation).toBeDefined();

    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.sources.length).toBe(1);
      expect(done.finalAnswer).toContain('Andre said X [1]');
    }
  });

  it('emits error event when queryFn throws', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-3' };
      throw new Error('boom');
    };
    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.message).toContain('boom');
  });

  it('emits done when iterator completes naturally without a result event', async () => {
    // Some SDK versions may not emit an explicit `result` message — the
    // stream just ends. runQuery should still emit a `done` event.
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-4' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'final' }] } };
      // No 'result' message — stream just ends here.
    };
    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.sessionId).toBe('sess-4');
      expect(last.finalAnswer).toContain('final');
    }
  });
});
```

- [ ] **Step 3: Implement**

```typescript
// src/engine/runQuery.ts
// Wraps @anthropic-ai/claude-agent-sdk's query() async iterable, dispatching
// SDK messages into typed RunQueryEvents that the CLI and (later) the web
// server consume.
//
// SDK message types used (dispatched on `m.type`, verified in node_modules
// during Step 1 of this task):
//   - 'system' (subtype 'init')   → session-init
//   - 'assistant' message         → walk content blocks (text, tool_use)
//   - 'user' message              → walk content blocks (tool_result)
//   - 'result'                    → done
// Adapt the dispatch keys if the real SDK names differ.

import { query as realQuery } from '@anthropic-ai/claude-agent-sdk';
import { join } from 'path';
import { loadDotEnvFile } from '../config/dotenv.js';
import type { McpServerConfig } from '../config/types.js';
import type { RunQueryOptions, RunQueryEvent, SourceCard } from './types.js';
import { buildSystemPrompt } from './system-prompt.js';
import { SourceTracker } from './source-tracker.js';

export interface RunQueryInternalOptions extends RunQueryOptions {
  /** Dependency-inject a fake query function for tests. */
  queryFn?: typeof realQuery;
}

export async function* runQuery(opts: RunQueryInternalOptions): AsyncIterable<RunQueryEvent> {
  // 1. Load .scry.env so the SDK sees ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL.
  loadDotEnvFile(join(opts.scryConfigDir, '.scry.env'));

  // 2. Build system prompt + mcpServers map.
  const systemPrompt = buildSystemPrompt({
    registry: opts.config.registry ?? { people: {}, projects: {} },
    fanoutMode: opts.fanoutMode ?? false,
  });
  const mcpServers = buildMcpServers(opts.config.mcp_servers);

  // 3. Set up abort.
  const abortController = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort();
    else opts.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  // 4. tool_use_id → { tool, server } correlation. tool_result blocks reference
  // tool_use_id from a prior assistant message; we look up here to attribute
  // the source card correctly.
  const toolUseMap = new Map<string, { tool: string; server: string }>();
  const tracker = new SourceTracker(opts.priorSources ?? []);

  // 5. Call SDK (or injected fake).
  const queryFn = opts.queryFn ?? realQuery;
  const stream = queryFn({
    prompt: opts.prompt,
    options: {
      systemPrompt,
      mcpServers,
      cwd: opts.scryConfigDir,
      resume: opts.resume,
      abortController,
    } as never, // SDK option type may not exactly match; cast conservatively
  });

  let sessionId = '';
  let finalAnswer = '';

  try {
    for await (const msg of stream as AsyncIterable<unknown>) {
      const m = msg as Record<string, unknown>;

      if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
        sessionId = m.session_id;
        yield { type: 'session-init', sessionId };
        continue;
      }

      if (m.type === 'assistant') {
        const content = ((m.message as { content?: unknown[] })?.content) ?? [];
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string') {
            finalAnswer = (finalAnswer ? finalAnswer + '\n' : '') + block.text;
            yield { type: 'assistant-text', text: block.text };
            for (const cit of tracker.validateMarkers(block.text)) {
              const card = tracker.sources.find((s) => s.index === cit.index)!;
              yield { type: 'citation', index: cit.index, source: card };
            }
          } else if (block.type === 'tool_use' && typeof block.id === 'string') {
            const toolName = (block.name as string) ?? 'unknown';
            const server = serverForTool(toolName, opts.config.search_tools);
            toolUseMap.set(block.id, { tool: toolName, server });
            yield { type: 'tool-call', tool: toolName, args: block.input ?? {} };
          }
        }
        continue;
      }

      if (m.type === 'user') {
        const content = ((m.message as { content?: unknown[] })?.content) ?? [];
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            const meta = toolUseMap.get(block.tool_use_id) ?? { tool: 'unknown', server: 'unknown' };
            const card = parseToolResult(block, meta, tracker);
            if (card) {
              yield { type: 'tool-result', tool: card.tool, sourceIndex: card.index, source: card };
            }
          }
        }
        continue;
      }

      if (m.type === 'result') {
        const sid = typeof m.session_id === 'string' ? m.session_id : sessionId;
        yield { type: 'done', sessionId: sid, sources: tracker.sources, finalAnswer };
        return;
      }
    }
    // Stream ended without `result`.
    yield { type: 'done', sessionId, sources: tracker.sources, finalAnswer };
  } catch (err) {
    yield { type: 'error', message: (err as Error).message ?? String(err) };
  }
}

// --- helpers ---

function buildMcpServers(
  servers: Record<string, McpServerConfig>,
): Record<string, { command: string; args?: string[]; env?: Record<string, string> }> {
  const out: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    out[name] = {
      command: cfg.command,
      args: cfg.args,
      env: cfg.env as Record<string, string> | undefined,
    };
  }
  return out;
}

function serverForTool(
  toolName: string,
  searchTools: Record<string, Array<{ tool: string }>>,
): string {
  for (const [server, tools] of Object.entries(searchTools)) {
    if (tools.some((t) => t.tool === toolName)) return server;
  }
  return 'unknown';
}

function parseToolResult(
  block: Record<string, unknown>,
  meta: { tool: string; server: string },
  tracker: SourceTracker,
): SourceCard | null {
  const raw = block.content;
  let payload: { title?: string; snippet?: string; author?: string; timestamp?: string; url?: string } = {};

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      payload = first ?? {};
    } catch {
      payload = { title: 'tool result', snippet: raw.slice(0, 200) };
    }
  }

  return tracker.recordToolResult(meta.server, meta.tool, {
    title: payload.title ?? 'untitled',
    snippet: payload.snippet ?? '',
    url: payload.url,
    author: payload.author,
    timestamp: payload.timestamp,
    raw,
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npm run build && npm test -- tests/engine/
```

If the real SDK's message shape differs from the test fixtures, **update both the implementation AND the fixtures to match the real shape**. The d.ts is the source of truth.

- [ ] **Step 5: Commit**

```bash
git add src/engine/runQuery.ts tests/engine/runQuery.test.ts
git commit -m "feat(engine): runQuery wraps Agent SDK with typed event stream"
```

---

This plan continues in **Plan B Part 2** (CLI restructure + delete old engine + PR). Splitting to keep each file readable. See [`2026-05-24-scry-engine-pivot-part2.md`](./2026-05-24-scry-engine-pivot-part2.md) for tasks 6–9.
