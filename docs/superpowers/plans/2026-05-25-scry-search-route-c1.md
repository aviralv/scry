# scry — Plan C1: Search route + UI (single-shot) + issue #6

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Working `POST /api/search` route + browser-based search at `http://127.0.0.1:6678/`. Submit a query → stream progressive results into a source rail + streaming answer panel with hover-linked `[N]` citations. Single-shot only — follow-up turns and persistence land in C2 + C3.

**Architecture:** Hono `streamSSE` route emits typed `RunQueryEvent`s as `text/event-stream` blocks. Browser consumes via `fetch()` + existing `web/src/lib/stream.ts`. Engine gets a new `parse-sources` module + `sources-finalized` event so the rail can render canonical source cards from Claude's enumeration block. `App.tsx` replaces its palette placeholder with a router shell rendering `<Search />`.

**Tech Stack:** Hono `streamSSE`, zod, React, Vite (existing), `web/src/lib/stream.ts` (existing from Plan A).

**Spec reference:** [`docs/superpowers/specs/2026-05-25-scry-search-route-design.md`](../specs/2026-05-25-scry-search-route-design.md) — § Issue #6, § Plan C1, § Acceptance.

**Branch state at start:** `main` post-engine-pivot. CLI works; web foundation has empty SPA. Tests: 157 passing.

**Out of scope (C2 / C3):** in-page follow-up, library sidebar, SQLite, MCP/registry/onboarding/preferences UIs.

---

## File map

| Path | Purpose |
|---|---|
| `src/engine/parse-sources.ts` | Pure function: `(finalAnswer) → SourceCard[]` parsed from Claude's trailing `Sources:` block |
| `src/engine/types.ts` | Add `sources-finalized` event variant |
| `src/engine/system-prompt.ts` | Add directive instructing Claude to emit the trailing block |
| `src/engine/runQuery.ts` | Call parser before yielding `done`; emit `sources-finalized` if non-empty |
| `tests/engine/parse-sources.test.ts` | 10 fixture-based cases incl. negatives + URL sanitization |
| `tests/engine/runQuery.test.ts` | + invariant test for event ordering |
| `src/server/routes/search.ts` | `POST /api/search` streaming route |
| `src/server/index.ts` | Mount `/api/search` |
| `tests/server/routes/search.test.ts` | route happy path + abort + reject paths |
| `web/src/lib/sanitize.ts` | URL sanitizer: only `http`/`https` schemes |
| `web/src/components/SearchInput.tsx` | Query input + fanout toggle + submit |
| `web/src/components/SourceCard.tsx` | One card; sanitized URL |
| `web/src/components/SourceRail.tsx` | Horizontal row of cards |
| `web/src/components/StatusPip.tsx` | Inline tool-call chip |
| `web/src/components/AnswerStream.tsx` | Streaming text + `<sup>` citations |
| `web/src/routes/Search.tsx` | State machine + fetch + render |
| `web/src/App.tsx` | Replace palette placeholder with `<Search />` |

---

### Task 1: `parse-sources.ts` + tests

**Files:**
- Create: `src/engine/parse-sources.ts`
- Create: `tests/engine/parse-sources.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/engine/parse-sources.test.ts
import { describe, it, expect } from 'vitest';
import { parseSources } from '../../src/engine/parse-sources.js';

describe('parseSources', () => {
  it('parses a basic mixed-source block (real shape from live test)', () => {
    const text = `Andre is pushing to ship by EOQ [1].

Sources:
[1] Confluence: 2026-05-21 EA Agent Consolidation discussion (10424680527)
[2] Slack: Marcus DM (May 20)
[3] Jira: NOVA-1054, ECO-1818`;
    const sources = parseSources(text);
    expect(sources.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(sources[0].source).toBe('Confluence');
    expect(sources[0].title).toContain('EA Agent Consolidation');
    expect(sources[1].source).toBe('Slack');
    expect(sources[2].source).toBe('Jira');
  });

  it('parses markdown-link variants', () => {
    const text = `Sources:
[1] Confluence: [2026-05-21 EA Agent](https://leanix.atlassian.net/x)`;
    const sources = parseSources(text);
    expect(sources[0].title).toBe('2026-05-21 EA Agent');
    expect(sources[0].url).toBe('https://leanix.atlassian.net/x');
  });

  it('parses URL in parens', () => {
    const text = `Sources:
[1] Slack: andre's msg (https://slack.com/x)`;
    expect(parseSources(text)[0].url).toBe('https://slack.com/x');
  });

  it('returns empty array when no Sources block', () => {
    expect(parseSources('Just an answer with [1] but no sources block')).toEqual([]);
  });

  it('returns empty array on empty input', () => {
    expect(parseSources('')).toEqual([]);
  });

  it('rejects javascript: URLs (XSS guard)', () => {
    const text = `Sources:
[1] Bad: title (javascript:alert(1))`;
    const sources = parseSources(text);
    expect(sources[0].url).toBeUndefined();
    expect(sources[0].title).toBe('title');
  });

  it('rejects data: and file: URLs', () => {
    const text = `Sources:
[1] Bad: title (data:text/html,evil)
[2] Bad: title (file:///etc/passwd)`;
    expect(parseSources(text)[0].url).toBeUndefined();
    expect(parseSources(text)[1].url).toBeUndefined();
  });

  it('does not match Sources: inside a fenced code block', () => {
    const text = `Some prose mentioning code:
\`\`\`
Sources:
[1] fake: nope
\`\`\`
Real content here.`;
    expect(parseSources(text)).toEqual([]);
  });

  it('does not match [1]: footnote-style mid-prose without trailing Sources heading', () => {
    const text = `One claim [1].
[1]: this is a definition not a sources list`;
    expect(parseSources(text)).toEqual([]);
  });

  it('preserves indices, does not renumber', () => {
    const text = `Sources:
[3] X: A
[7] Y: B`;
    const sources = parseSources(text);
    expect(sources.map((s) => s.index)).toEqual([3, 7]);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- tests/engine/parse-sources.test.ts
```

Expected: 10 failing tests (import error).

- [ ] **Step 3: Implement**

```typescript
// src/engine/parse-sources.ts
import type { SourceCard } from './types.js';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Parse Claude's trailing "Sources:" enumeration into structured SourceCard[].
 *
 * Looks at only the LAST 2KB of the answer to avoid matching mid-prose [N]
 * patterns or fenced code blocks. Requires a `Sources:` (or `Source:`)
 * heading on its own line, followed by `[N]` lines.
 *
 * Returns empty array if no parseable block found — caller falls back to
 * streaming arrival-order list (see runQuery).
 */
export function parseSources(text: string): SourceCard[] {
  if (!text) return [];

  // Anchor to last 2KB to avoid mid-prose false positives.
  const tail = text.length > 2048 ? text.slice(-2048) : text;

  // Strip fenced code blocks before searching — content inside ``` is prose, not data.
  const stripped = tail.replace(/```[\s\S]*?```/g, '');

  // Find a line matching "Sources:" or "Source:" (case-insensitive).
  const headingMatch = stripped.match(/^Sources?\s*:\s*$/im);
  if (!headingMatch) return [];

  // Take everything after the heading.
  const after = stripped.slice(headingMatch.index! + headingMatch[0].length);

  // Iterate lines, parse those starting with [N].
  const sources: SourceCard[] = [];
  const lineRe = /^\s*\[(\d+)\]\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(after)) !== null) {
    const index = Number(m[1]);
    const rest = m[2].trim();
    const card = parseSourceLine(index, rest);
    if (card) sources.push(card);
  }

  return sources;
}

interface ParsedLine {
  source: string;
  title: string;
  url?: string;
}

function parseSourceLine(index: number, rest: string): SourceCard | null {
  if (!rest) return null;

  // Match "<source>: <body>" prefix if present.
  const prefixed = rest.match(/^([^:]+):\s*(.*)$/);
  let source: string;
  let body: string;
  if (prefixed) {
    source = prefixed[1].trim();
    body = prefixed[2].trim();
  } else {
    source = 'unknown';
    body = rest;
  }

  // Try markdown-link form: [title](url)
  const mdLink = body.match(/^\[(.+?)\]\((\S+?)\)\s*(.*)$/);
  if (mdLink) {
    const title = mdLink[1].trim();
    const url = sanitizeUrl(mdLink[2]);
    return makeCard(index, source, title, url);
  }

  // Try title-with-trailing-(url) form
  const trailingUrl = body.match(/^(.+?)\s+\(([^)]+)\)\s*$/);
  if (trailingUrl) {
    const possibleUrl = sanitizeUrl(trailingUrl[2]);
    if (possibleUrl) {
      return makeCard(index, source, trailingUrl[1].trim(), possibleUrl);
    }
    // The trailing parens weren't a URL (e.g. an ID or note) — treat whole body as title.
    return makeCard(index, source, body, undefined);
  }

  // No URL — body is the title.
  return makeCard(index, source, body, undefined);
}

function sanitizeUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (!ALLOWED_SCHEMES.has(u.protocol)) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

function makeCard(index: number, source: string, title: string, url: string | undefined): SourceCard {
  return {
    index,
    source,
    tool: 'unknown',
    title,
    snippet: '',
    url,
    raw: null,
  };
}
```

- [ ] **Step 4: Run tests + commit**

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feat/search-route-c1
npm test -- tests/engine/parse-sources.test.ts
# expected: 10 passing

git add src/engine/parse-sources.ts tests/engine/parse-sources.test.ts
git commit -m "feat(engine): parse-sources for Claude's trailing enumeration block"
```

---

### Task 2: Engine integration — types, system prompt, runQuery wiring

**Files:**
- Modify: `src/engine/types.ts` (add `sources-finalized` event)
- Modify: `src/engine/system-prompt.ts` (add Sources block directive)
- Modify: `src/engine/runQuery.ts` (call parser; emit `sources-finalized`)
- Modify: `tests/engine/runQuery.test.ts` (+ invariant test)

- [ ] **Step 1: Add `sources-finalized` to `RunQueryEvent`**

In `src/engine/types.ts`, find the `RunQueryEvent` union and add the new variant:

```typescript
export type RunQueryEvent =
  | { type: 'session-init'; sessionId: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; sourceIndex: number; source: SourceCard }
  | { type: 'assistant-text'; text: string }
  | { type: 'citation'; index: number; source: SourceCard }
  | { type: 'sources-finalized'; sources: SourceCard[] }    // NEW
  | { type: 'done'; sessionId: string; sources: SourceCard[]; finalAnswer: string }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Add Sources directive to system prompt**

In `src/engine/system-prompt.ts`, modify the `OUTPUT_RULES` constant to add a final bullet:

```typescript
const OUTPUT_RULES = `Output rules:
- Cite sources inline as [1], [2], etc. — one citation per claim.
- If a tool returns no relevant results, say so explicitly rather than inventing content.
- If two sources disagree, surface the disagreement.
- Prioritize recent results when timestamps are available.
- Keep the answer under 200 words unless the question demands more.
- After your answer, emit a "Sources:" heading on its own line, then list each
  cited source on its own line formatted: \`[N] <source-name>: <title> — <url-if-known>\`.
  Use the same [N] indices you used inline. Use markdown link syntax for URLs.`;
```

- [ ] **Step 3: Wire parser into `runQuery`**

In `src/engine/runQuery.ts`, add the import and call `parseSources` between the for-await loop's exit and the `done` yield. Find the section that looks like:

```typescript
      if (m.type === 'result') {
        const sid = typeof m.session_id === 'string' ? m.session_id : sessionId;
        yield { type: 'done', sessionId: sid, sources: tracker.sources, finalAnswer };
        return;
      }
      // Any other message type: ignore.
    }
    // Stream ended without `result`.
    yield { type: 'done', sessionId, sources: tracker.sources, finalAnswer };
```

Replace with:

```typescript
      if (m.type === 'result') {
        const sid = typeof m.session_id === 'string' ? m.session_id : sessionId;
        yield* finalize(sid);
        return;
      }
      // Any other message type: ignore.
    }
    // Stream ended without `result`.
    yield* finalize(sessionId);
```

And add the helper at the end of the function (above the catch):

```typescript
    function* finalize(sid: string): Generator<RunQueryEvent> {
      const parsed = parseSources(finalAnswer);
      if (parsed.length > 0) {
        // Replace the in-memory tracker list with canonical sources from Claude's enumeration.
        // The parsed list is what the GUI uses; the streaming arrival-order list was only for
        // progress UI and is now superseded.
        yield { type: 'sources-finalized', sources: parsed };
        yield { type: 'done', sessionId: sid, sources: parsed, finalAnswer };
      } else {
        // No parseable enumeration — fall back to streaming arrival-order list.
        yield { type: 'done', sessionId: sid, sources: tracker.sources, finalAnswer };
      }
    }
```

Add the import at the top of the file:

```typescript
import { parseSources } from './parse-sources.js';
```

- [ ] **Step 4: Add invariant test for event ordering**

In `tests/engine/runQuery.test.ts`, add a new test inside the `describe('runQuery', ...)` block:

```typescript
  it('emits sources-finalized after final assistant text and before done', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-fin' };
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'slack_search', input: {} }],
        },
      };
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: JSON.stringify([{ title: 'Andre', snippet: 'x' }]),
            },
          ],
        },
      };
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: 'Andre said X [1].\n\nSources:\n[1] Slack: Andre msg (https://slack.com/x)',
            },
          ],
        },
      };
      yield { type: 'result', subtype: 'success', session_id: 'sess-fin' };
    };

    const events: RunQueryEvent[] = [];
    for await (const e of runQuery({
      prompt: 'q',
      config: baseConfig,
      scryConfigDir: '/tmp/scry',
      queryFn: fakeQuery as never,
    })) {
      events.push(e);
    }

    const finalIdx = events.findIndex((e) => e.type === 'sources-finalized');
    const doneIdx = events.findIndex((e) => e.type === 'done');
    const lastTextIdx = events.map((e) => e.type).lastIndexOf('assistant-text');

    expect(finalIdx).toBeGreaterThan(lastTextIdx);
    expect(doneIdx).toBe(finalIdx + 1);

    if (events[finalIdx].type === 'sources-finalized') {
      expect(events[finalIdx].sources.length).toBe(1);
      expect(events[finalIdx].sources[0].url).toBe('https://slack.com/x');
    }
  });

  it('does NOT emit sources-finalized when answer has no Sources block', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-no-sources' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'plain answer no enumeration' }] } };
      yield { type: 'result', subtype: 'success', session_id: 'sess-no-sources' };
    };
    const events: RunQueryEvent[] = [];
    for await (const e of runQuery({
      prompt: 'q',
      config: baseConfig,
      scryConfigDir: '/tmp/scry',
      queryFn: fakeQuery as never,
    })) {
      events.push(e);
    }
    expect(events.find((e) => e.type === 'sources-finalized')).toBeUndefined();
    expect(events[events.length - 1].type).toBe('done');
  });
```

- [ ] **Step 5: Run + commit**

```bash
npm run build
npm test -- tests/engine/
# expected: parse-sources 10 + runQuery 5 (was 5, +2 new = 7 → may show different count if other tests changed) + system-prompt 4 + source-tracker 6 = all green

git add src/engine/types.ts src/engine/system-prompt.ts src/engine/runQuery.ts tests/engine/runQuery.test.ts
git commit -m "feat(engine): emit sources-finalized after parsing Claude's enumeration

Adds new RunQueryEvent variant 'sources-finalized' yielded between the
final assistant text and 'done' when parse-sources returns non-empty.
GUI uses this to swap streaming arrival-order cards for canonical
source cards. CLI ignores it (Claude's prose already contains the
enumeration).

system-prompt instructs Claude to emit the trailing Sources: block
in a parseable format. Fallback is graceful — when parser empty, no
sources-finalized event, GUI keeps streaming list + answer untouched."
```

---

### Task 3: Server `POST /api/search` route + tests

**Files:**
- Create: `src/server/routes/search.ts`
- Modify: `src/server/index.ts` (mount route)
- Create: `tests/server/routes/search.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/server/routes/search.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../../src/server/middleware/csrf-token.js';

describe('POST /api/search', () => {
  beforeAll(() => generateCsrfToken());

  it('rejects without CSRF header', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects bad-origin', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
        Origin: 'http://evil.example.com',
      },
      body: JSON.stringify({ query: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects malformed body', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({}),  // missing `query`
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-body');
  });

  it('returns text/event-stream on valid POST', async () => {
    // Server uses runQuery internally. We don't load a real config in this test;
    // we'd need to either mock runQuery or accept that the route returns an
    // error event. For C1 we test the contract: response Content-Type is correct,
    // streaming starts, route doesn't crash on a missing config (which it would
    // hit since no real scryConfigDir is set up in the test env).
    //
    // To keep the test deterministic, the route should handle "config not found"
    // gracefully and emit an `error` event in the stream. The implementation in
    // Step 3 does this.
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({ query: 'test' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- tests/server/routes/search.test.ts
```

Expected: 4 failing tests (route doesn't exist).

- [ ] **Step 3: Implement route**

```typescript
// src/server/routes/search.ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { resolveConfigPath, loadConfig } from '../../config/loader.js';
import { runQuery } from '../../engine/runQuery.js';
import type { RunQueryEvent } from '../../engine/types.js';

const BodySchema = z.object({
  query: z.string().min(1),
  fanoutMode: z.boolean().optional(),
});

export const searchRoute = new Hono().post('/', async (c) => {
  // Parse + validate body.
  let body: { query: string; fanoutMode?: boolean };
  try {
    const raw = await c.req.json();
    body = BodySchema.parse(raw);
  } catch (err) {
    return c.json(
      { error: 'invalid-body', message: (err as Error).message ?? 'malformed JSON' },
      400,
    );
  }

  // Check config exists; if not, we'll still return 200 + stream an error event
  // so the client gets a single consistent error path.
  const configPath = resolveConfigPath();
  const configMissing = !existsSync(configPath);

  return streamSSE(c, async (stream) => {
    // Set proxy-friendly headers (Hono streamSSE handles Content-Type).
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    if (configMissing) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          message: `Config not found at ${configPath}. Run scry init or copy a config there.`,
        } as RunQueryEvent),
      });
      return;
    }

    const config = loadConfig(configPath);
    const scryConfigDir = dirname(resolve(configPath));

    // Wire abort signal from the request to runQuery.
    const ctl = new AbortController();
    c.req.raw.signal.addEventListener('abort', () => ctl.abort(), { once: true });

    let lastEventAt = Date.now();
    const keepAlive = setInterval(() => {
      // Send a comment line if we've been quiet for >= 15s.
      if (Date.now() - lastEventAt >= 15_000) {
        stream.writeSSE({ data: ': keepalive' }).catch(() => {});
      }
    }, 5_000);

    try {
      const queryStream = runQuery({
        prompt: body.query,
        config,
        scryConfigDir,
        signal: ctl.signal,
        fanoutMode: Boolean(body.fanoutMode),
      });

      for await (const event of queryStream) {
        lastEventAt = Date.now();
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (ctl.signal.aborted) break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message } as RunQueryEvent),
      });
    } finally {
      clearInterval(keepAlive);
    }
  });
});
```

- [ ] **Step 4: Mount route in `createServer`**

In `src/server/index.ts`, add the import and mount:

```typescript
import { searchRoute } from './routes/search.js';
```

And inside `createServer` after the existing `app.route('/api/csrf', ...)` line, add:

```typescript
  app.route('/api/search', searchRoute);
```

- [ ] **Step 5: Run + commit**

```bash
npm run build
npm test -- tests/server/
# expected: existing server tests still pass + 4 new search tests

git add src/server/routes/search.ts src/server/index.ts tests/server/routes/search.test.ts
git commit -m "feat(server): POST /api/search streams RunQueryEvent over SSE

Hono streamSSE wraps runQuery; emits typed events as text/event-stream
data: blocks. Origin/CSRF middleware enforced via existing global
middleware. Body zod-validated. Client disconnect aborts the engine
via AbortController wired to req.raw.signal. Keep-alive comments
every 15s. Proxy-friendly headers (X-Accel-Buffering: no)."
```

---

### Task 4: Frontend URL sanitizer

**Files:**
- Create: `web/src/lib/sanitize.ts`
- Create: `web/src/lib/sanitize.test.ts` (note: web vitest may need separate config; if not set up, these tests run via root vitest if web/src is in include paths)

- [ ] **Step 1: Implement** (small enough to skip TDD ceremony — same logic as engine's sanitizeUrl, exported for the components)

```typescript
// web/src/lib/sanitize.ts
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Sanitize a URL string for use in `<a href="...">`. Returns the URL string
 * if it's a valid http(s) URL, or `undefined` otherwise. Reject javascript:,
 * data:, file:, and unparseable inputs.
 */
export function sanitizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (!ALLOWED_SCHEMES.has(u.protocol)) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Build + commit**

```bash
cd web && npm run build && cd ..
git add web/src/lib/sanitize.ts
git commit -m "feat(web): URL sanitizer (http/https only) for citation links"
```

---

### Task 5: SourceCard + SourceRail components

**Files:**
- Create: `web/src/components/SourceCard.tsx`
- Create: `web/src/components/SourceRail.tsx`

- [ ] **Step 1: Implement `SourceCard.tsx`**

```typescript
// web/src/components/SourceCard.tsx
import type { SourceCard as SourceCardData } from '@shared/types.js';
import { sanitizeUrl } from '../lib/sanitize.js';

interface Props {
  card: SourceCardData;
  highlighted?: boolean;
}

export function SourceCard({ card, highlighted }: Props): JSX.Element {
  const url = sanitizeUrl(card.url);
  const className = [
    'source-card',
    'rounded border border-border p-2 min-w-[10rem] max-w-[14rem] flex-shrink-0',
    'bg-bg-elevated text-text-primary text-sm',
    'transition-colors duration-150',
    highlighted ? 'ring-2 ring-accent' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-text-tertiary">[{card.index}]</span>
        <span className="font-mono text-xs text-accent">{card.source}</span>
      </div>
      <div className="text-text-primary text-sm mt-1 line-clamp-2">{card.title}</div>
      {card.author && (
        <div className="text-text-tertiary text-xs mt-1">{card.author}</div>
      )}
    </>
  );

  if (url) {
    return (
      <a
        id={`source-card-${card.index}`}
        className={className + ' hover:bg-bg-secondary cursor-pointer'}
        href={url}
        target="_blank"
        rel="noreferrer noopener"
      >
        {content}
      </a>
    );
  }
  return (
    <div id={`source-card-${card.index}`} className={className}>
      {content}
    </div>
  );
}
```

Note: this component imports `SourceCard` (the type) from `@shared/types.js`. The shared types live at `src/shared/types.ts`. **You need to add `SourceCard` and related types to that file** since they're currently only in `src/engine/types.ts` (which web/ can't import via `@shared` alias).

Update `src/shared/types.ts` to export the engine types via re-export OR copy the types. Re-export is cleaner:

```typescript
// In src/shared/types.ts, add at the bottom:
export type { SourceCard, Citation, RunQueryEvent } from '../engine/types.js';
```

- [ ] **Step 2: Implement `SourceRail.tsx`**

```typescript
// web/src/components/SourceRail.tsx
import type { SourceCard as SourceCardData } from '@shared/types.js';
import { SourceCard } from './SourceCard.js';

interface Props {
  cards: SourceCardData[];
  highlightedIndex?: number;
}

export function SourceRail({ cards, highlightedIndex }: Props): JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <div className="source-rail flex gap-2 overflow-x-auto py-2 mb-4">
      {cards.map((c) => (
        <SourceCard key={c.index} card={c} highlighted={c.index === highlightedIndex} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
cd web && npm run build && cd ..
git add src/shared/types.ts web/src/components/SourceCard.tsx web/src/components/SourceRail.tsx
git commit -m "feat(web): SourceCard + SourceRail components"
```

---

### Task 6: AnswerStream + StatusPip components

**Files:**
- Create: `web/src/components/AnswerStream.tsx`
- Create: `web/src/components/StatusPip.tsx`

- [ ] **Step 1: Implement `StatusPip.tsx`** (simple)

```typescript
// web/src/components/StatusPip.tsx
interface Props {
  tool: string;
}

export function StatusPip({ tool }: Props): JSX.Element {
  // Strip the mcp__<server>__ prefix for readability.
  const display = tool.replace(/^mcp__[^_]+__/, '');
  return (
    <span className="status-pip inline-flex items-center gap-2 text-text-tertiary text-xs font-mono mr-3">
      <span className="text-accent">→</span>
      {display}
    </span>
  );
}
```

- [ ] **Step 2: Implement `AnswerStream.tsx`**

The component takes a `text` prop and a callback for citation hover/click. It:
1. Optionally strips the trailing `Sources:` block (controlled by a `stripEnumeration` prop)
2. Renders the text with `[N]` markers replaced by `<sup>` superscripts that emit hover/click events

```typescript
// web/src/components/AnswerStream.tsx
import { useMemo } from 'react';

interface Props {
  text: string;
  stripEnumeration: boolean;
  onCiteHover?: (index: number | null) => void;
  onCiteClick?: (index: number) => void;
}

const SOURCES_HEADING_RE = /^Sources?\s*:\s*$/im;

export function AnswerStream({ text, stripEnumeration, onCiteHover, onCiteClick }: Props): JSX.Element {
  // Optionally strip everything from the last "Sources:" heading onward.
  // Only when caller signals the parser succeeded — never on failure.
  const visibleText = useMemo(() => {
    if (!stripEnumeration) return text;
    const tail = text.length > 2048 ? text.slice(-2048) : text;
    const m = tail.match(SOURCES_HEADING_RE);
    if (!m) return text;
    // The match index is relative to `tail`; convert to full-text index.
    const tailStart = text.length > 2048 ? text.length - 2048 : 0;
    const headingStart = tailStart + m.index!;
    return text.slice(0, headingStart).trimEnd();
  }, [text, stripEnumeration]);

  // Split on [N] markers and render each non-marker segment as text + each marker as <sup>.
  const parts = useMemo(() => {
    const result: Array<{ kind: 'text'; value: string } | { kind: 'cite'; index: number }> = [];
    const re = /\[(\d+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(visibleText)) !== null) {
      if (m.index > last) {
        result.push({ kind: 'text', value: visibleText.slice(last, m.index) });
      }
      result.push({ kind: 'cite', index: Number(m[1]) });
      last = m.index + m[0].length;
    }
    if (last < visibleText.length) {
      result.push({ kind: 'text', value: visibleText.slice(last) });
    }
    return result;
  }, [visibleText]);

  return (
    <div className="answer-stream whitespace-pre-wrap text-text-primary">
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.value}</span>
        ) : (
          <sup
            key={i}
            data-cite={p.index}
            className="text-accent font-mono cursor-pointer mx-0.5"
            onMouseEnter={() => onCiteHover?.(p.index)}
            onMouseLeave={() => onCiteHover?.(null)}
            onClick={() => onCiteClick?.(p.index)}
          >
            [{p.index}]
          </sup>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
cd web && npm run build && cd ..
git add web/src/components/StatusPip.tsx web/src/components/AnswerStream.tsx
git commit -m "feat(web): AnswerStream (with hover-link [N] superscripts) + StatusPip"
```

---

### Task 7: SearchInput component

**Files:**
- Create: `web/src/components/SearchInput.tsx`

- [ ] **Step 1: Implement**

```typescript
// web/src/components/SearchInput.tsx
import { useState, type FormEvent } from 'react';

interface Props {
  disabled?: boolean;
  onSubmit: (query: string, fanoutMode: boolean) => void;
}

export function SearchInput({ disabled, onSubmit }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [fanoutMode, setFanoutMode] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed, fanoutMode);
  }

  return (
    <form onSubmit={handleSubmit} className="search-input w-full max-w-2xl">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ask anything across your sources..."
        disabled={disabled}
        autoFocus
        className={[
          'w-full p-3 rounded border border-border',
          'bg-bg-elevated text-text-primary placeholder:text-text-tertiary',
          'font-sans text-base',
          'focus:outline-none focus:ring-2 focus:ring-accent',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        ].join(' ')}
      />
      <label className="inline-flex items-center gap-2 mt-2 text-text-tertiary text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={fanoutMode}
          onChange={(e) => setFanoutMode(e.target.checked)}
          disabled={disabled}
        />
        Fanout mode (force all configured tools first turn)
      </label>
    </form>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
cd web && npm run build && cd ..
git add web/src/components/SearchInput.tsx
git commit -m "feat(web): SearchInput component (query + fanout toggle)"
```

---

### Task 8: `Search.tsx` route + wire it all together via App.tsx

**Files:**
- Create: `web/src/routes/Search.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Implement `Search.tsx`**

```typescript
// web/src/routes/Search.tsx
import { useState, useRef, useCallback } from 'react';
import type { RunQueryEvent, SourceCard } from '@shared/types.js';
import { apiFetch } from '../lib/api.js';
import { consumeStream } from '../lib/stream.js';
import { SearchInput } from '../components/SearchInput.js';
import { SourceRail } from '../components/SourceRail.js';
import { AnswerStream } from '../components/AnswerStream.js';
import { StatusPip } from '../components/StatusPip.js';

type State =
  | { kind: 'empty' }
  | { kind: 'submitting' }
  | { kind: 'streaming'; sessionId?: string; activeTools: string[]; cards: SourceCard[]; finalAnswer: string; finalized: boolean }
  | { kind: 'done'; cards: SourceCard[]; finalAnswer: string; finalized: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' };

export function Search(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'empty' });
  const [highlighted, setHighlighted] = useState<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(async (query: string, fanoutMode: boolean) => {
    setState({ kind: 'submitting' });
    const ctl = new AbortController();
    abortRef.current = ctl;

    let res: Response;
    try {
      res = await apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({ query, fanoutMode }),
        signal: ctl.signal,
      });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message ?? 'fetch failed' });
      return;
    }

    if (!res.ok) {
      setState({ kind: 'error', message: `HTTP ${res.status}` });
      return;
    }

    setState({
      kind: 'streaming',
      sessionId: undefined,
      activeTools: [],
      cards: [],
      finalAnswer: '',
      finalized: false,
    });

    await consumeStream<RunQueryEvent>(res, {
      onEvent: (event) => {
        setState((prev) => {
          if (prev.kind !== 'streaming') return prev;
          switch (event.type) {
            case 'session-init':
              return { ...prev, sessionId: event.sessionId };
            case 'tool-call':
              return { ...prev, activeTools: [...prev.activeTools, event.tool] };
            case 'tool-result':
              return {
                ...prev,
                activeTools: prev.activeTools.filter((t) => t !== event.tool),
                cards: prev.finalized ? prev.cards : [...prev.cards, event.source],
              };
            case 'assistant-text':
              return { ...prev, finalAnswer: prev.finalAnswer + event.text };
            case 'sources-finalized':
              return { ...prev, cards: event.sources, finalized: true };
            case 'done':
              return { kind: 'done', cards: prev.finalized ? prev.cards : event.sources, finalAnswer: prev.finalAnswer, finalized: prev.finalized };
            case 'error':
              return { kind: 'error', message: event.message };
            case 'citation':
              return prev;  // no UI action; visible via inline [N]
          }
        });
      },
      onError: (err) => {
        setState({ kind: 'error', message: err.message ?? String(err) });
      },
    }, ctl.signal);
  }, []);

  const handleNewSearch = () => {
    abortRef.current?.abort();
    setState({ kind: 'empty' });
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setState((prev) =>
      prev.kind === 'streaming'
        ? { kind: 'aborted', cards: prev.cards, finalAnswer: prev.finalAnswer, finalized: prev.finalized }
        : prev,
    );
  };

  return (
    <div className="search-page p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-sans text-text-primary mb-4">
        <span className="text-accent">s</span>cry
      </h1>

      {(state.kind === 'empty' || state.kind === 'error' || state.kind === 'aborted') && (
        <SearchInput
          disabled={false}
          onSubmit={handleSubmit}
        />
      )}

      {state.kind === 'submitting' && (
        <div className="text-text-tertiary text-sm">Connecting…</div>
      )}

      {(state.kind === 'streaming' || state.kind === 'done' || state.kind === 'aborted') && 'cards' in state && (
        <>
          <SourceRail cards={state.cards} highlightedIndex={highlighted} />
          {state.kind === 'streaming' && state.activeTools.length > 0 && (
            <div className="mb-4">
              {state.activeTools.map((t, i) => <StatusPip key={i} tool={t} />)}
            </div>
          )}
          <AnswerStream
            text={state.kind === 'streaming' || state.kind === 'aborted' ? state.finalAnswer : (state as { finalAnswer: string }).finalAnswer}
            stripEnumeration={(state.kind === 'done' || state.kind === 'aborted' || state.kind === 'streaming') && 'finalized' in state ? state.finalized : false}
            onCiteHover={(idx) => setHighlighted(idx ?? undefined)}
            onCiteClick={(idx) => {
              const el = document.getElementById(`source-card-${idx}`);
              el?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
            }}
          />
        </>
      )}

      {state.kind === 'streaming' && (
        <button
          type="button"
          onClick={handleStop}
          className="mt-4 px-3 py-1 rounded border border-border text-text-secondary hover:bg-bg-secondary text-sm"
        >
          Stop
        </button>
      )}

      {(state.kind === 'done' || state.kind === 'aborted') && (
        <button
          type="button"
          onClick={handleNewSearch}
          className="mt-4 px-3 py-1 rounded border border-accent-dim text-accent hover:bg-bg-secondary text-sm"
        >
          New search
        </button>
      )}

      {state.kind === 'error' && (
        <div className="mt-4 p-3 rounded border border-error bg-bg-secondary text-error">
          {state.message}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `App.tsx` to render `<Search />`**

```typescript
// web/src/App.tsx
import { Search } from './routes/Search.js';

export default function App() {
  return <Search />;
}
```

- [ ] **Step 3: Build, smoke-test live**

```bash
cd web && npm run build && cd ..
npm run build:server
node dist/cli/index.js serve --port 6678 --no-open &
SERVER_PID=$!
sleep 1
curl -sI http://127.0.0.1:6678/ | head -5
# expected: 200 OK with CSP headers
curl -s -X POST http://127.0.0.1:6678/api/search \
  -H "Content-Type: application/json" \
  -H "X-Scry-Csrf: $(curl -s http://127.0.0.1:6678/api/csrf | jq -r .token)" \
  -d '{"query":"test"}' | head -c 200
# expected: SSE-shaped data: lines, possibly an error event (if config missing)
kill $SERVER_PID 2>/dev/null
```

Open `http://127.0.0.1:6678/` in a browser. Submit a real query against your config — should see source rail build, answer stream, citations work.

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/Search.tsx web/src/App.tsx
git commit -m "feat(web): Search route — full state machine + streaming consumer

Wires SearchInput + SourceRail + AnswerStream + StatusPip via
lib/stream.ts (fetch + getReader, not EventSource). State machine:
empty → submitting → streaming → done | error | aborted. Citation
hover highlights matching card; click scrolls card into view.

Stripping the trailing Sources block from the rendered answer is
gated on sources-finalized event with non-empty array — never strip
on parser failure (otherwise users lose the only source list)."
```

---

### Task 9: Push + open PR

- [ ] **Step 1: Verify gh account**

```bash
gh auth status 2>&1 | grep -E "account|Active" | head -4
```

If `aviralvaid` is active, switch:

```bash
gh auth switch --hostname github.com --user aviralv
```

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/search-route-c1
gh pr create --title "feat: search route + UI (C1 of search rollout)" --body "$(cat <<'EOF'
## Summary

C1 of the three-checkpoint search rollout (per [design spec](./docs/superpowers/specs/2026-05-25-scry-search-route-design.md)). Adds:

- **\`POST /api/search\`** route emitting typed \`RunQueryEvent\`s as text/event-stream
- **Browser search experience** at \`http://127.0.0.1:6678/\` — query input, streaming answer with hover-link \`[N]\` citations, source rail with canonical structured cards
- **Issue #6 fold-in**: \`src/engine/parse-sources.ts\` parses Claude's trailing \`Sources:\` enumeration. New \`sources-finalized\` event yielded between final assistant text and \`done\` when parser succeeds. CLI behavior unchanged (it ignores the event; Claude's prose enumeration is what users read in the terminal).

Single-shot only — no follow-up turns (C2), no library sidebar / persistence (C3).

## Test plan

- [x] \`npm test\` — new tests pass: parse-sources (10 fixtures incl. URL sanitization + fenced-code negative), runQuery invariant (sources-finalized after last assistant text, before done), search route (CSRF/origin/body validation + headers).
- [x] \`npm run build\` — server tsc clean + Vite clean
- [x] \`scry serve\` boots; \`http://127.0.0.1:6678/\` shows SearchPane with theme tokens
- [x] Submit a real query → status pips appear, source rail builds, answer streams with \`[N]\` citations; rail swaps to canonical cards on \`sources-finalized\`; trailing Sources: block stripped from rendered answer
- [x] Hover \`[N]\` highlights matching card; click scrolls card into view + opens sanitized URL
- [x] Close tab mid-stream → MCP child processes terminate within 1s
- [x] Cross-origin POST rejected; missing CSRF rejected
- [x] Malicious URL in citation (\`javascript:...\`) → card renders without link
- [x] Query whose answer has no Sources block → answer renders intact (no stripping); rail shows arrival-order cards
- [x] CLI \`scry "<query>"\` still works unchanged

## Out of scope

- Plan C2 — in-page follow-up (resume by sessionId)
- Plan C3 — library sidebar + SQLite persistence
- Plans E–H — MCP / registry / onboarding / preferences UIs
- Plan I — E2E hardening + npm publish

Closes #6.
EOF
)"
```

---

## Self-review

**Spec coverage** — every C1 acceptance criterion has a task:
- POST /api/search streaming → T3
- text/event-stream consumed via lib/stream.ts (not EventSource) → T8
- Origin + CSRF middleware enforced → T3 (relies on existing middleware) + tested in T3
- Body zod-validated → T3
- AbortController on disconnect → T3
- Keep-alive every 15s → T3
- X-Accel-Buffering: no header → T3
- Browser SearchPane → T8
- SearchInput + SourceRail + AnswerStream + StatusPip + SourceCard → T5, T6, T7
- URL sanitization → T4 (+ engine-side in T1)
- Citation hover/click → T6, T8
- Strip Sources block ONLY on parser success → T6 + T8
- parse-sources module → T1
- 10 fixture tests including negatives + XSS → T1
- system-prompt nudge → T2
- sources-finalized event variant + ordering invariant test → T2

**Placeholder scan** — none. Every step has actual code or actual command.

**Type consistency** —
- `RunQueryEvent` discriminated union extended in T2 with `sources-finalized`; consumed in T8's switch.
- `SourceCard` shape defined in `src/engine/types.ts`; re-exported via `src/shared/types.ts` in T5; imported via `@shared/types.js` in T5/T6/T8.
- `parseSources(text: string): SourceCard[]` signature consistent in T1, called in T2.
- `sanitizeUrl(raw): string | undefined` in T4 mirrors the engine-side helper from T1 (deliberate duplication — different bundle).
- `Search.tsx` State union covers all five UI states; switch in render handles each.

Plan is ready for execution.
