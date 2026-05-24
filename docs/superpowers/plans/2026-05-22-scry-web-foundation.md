# scry web frontend — Plan A: Foundation

> **⚠ SUPERSEDED by [2026-05-22-scry-web-foundation-v2.md](./2026-05-22-scry-web-foundation-v2.md).** Engine pivoted to `@anthropic-ai/claude-agent-sdk` after this plan was written; the AbortSignal-through-engine task no longer applies. v2 picks up from the current branch state (W1, W2, W4 already merged on `feat/web-foundation`). Kept for history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the server + frontend foundation so subsequent plans (search, MCP, settings, onboarding) can land vertical slices on top of working infrastructure. By the end of Plan A: an empty React SPA loads from a Hono server with CSRF + Origin hardening, the engine accepts `AbortSignal`, and atomic config writes are available as a shared utility.

**Architecture:** Hono server in `src/server/` runs in-process with the existing TS engine. Shared types in `src/shared/`. React + Vite + Tailwind in `web/` with its own `package.json` so dev deps don't bloat the runtime. CLI gains a `scry serve` subcommand that boots the server and opens a browser.

**Tech Stack:** Hono + `@hono/node-server`, zod (schema validation), Vite + React + TypeScript + Tailwind, `open` (browser launch), existing scry engine.

**Spec reference:** `docs/superpowers/specs/2026-05-21-scry-web-frontend-design.md` — read the Architecture, Security, and Repo layout sections before starting.

**Out of scope for Plan A** (covered by later plans): search route + UI, MCP manager, settings, onboarding wizard, E2E tests, packaging hardening.

---

## File map (additions only)

| Path | Purpose |
|---|---|
| `src/shared/types.ts` | Types referenced by both server and web (CsrfBootstrap, ApiError, future SearchEvent etc.) |
| `src/server/index.ts` | `createServer(config)` returning a Hono app |
| `src/server/boot.ts` | `startServer(port, config)` — listens via `@hono/node-server`, returns the Node `http.Server` for tests |
| `src/server/middleware/origin.ts` | Origin allowlist middleware |
| `src/server/middleware/csrf.ts` | Per-boot token check on mutating routes |
| `src/server/middleware/csrf-token.ts` | Generates token at boot, exposes via `getCsrfToken()` |
| `src/server/routes/health.ts` | `GET /api/health` (sanity check) |
| `src/server/routes/csrf.ts` | `GET /api/csrf` returns the token (alternative to the meta-tag injection path) |
| `src/server/static.ts` | Serve `dist/web/*`; rewrite `index.html` to inject CSRF token into a `<meta>` tag |
| `src/config/atomic-write.ts` | `atomicWriteConfig(path, content)` — tmp + fsync + rename + .bak |
| `src/core/abort.ts` | Tiny helper: `raceAbort(promise, signal)` for engine internals that don't natively support `AbortSignal` |
| `web/package.json` | Local deps: react, react-dom, vite, tailwindcss, typescript, @types/* |
| `web/vite.config.ts` | Build to `../dist/web`, dev proxy `/api/*` → `:6678` |
| `web/tsconfig.json` | Path alias `@shared/*` → `../src/shared/*` |
| `web/index.html` | Bootstrap shell with `<meta name="scry-csrf" content="__SCRY_CSRF__">` placeholder |
| `web/src/main.tsx` | React entry |
| `web/src/App.tsx` | Empty router shell |
| `web/src/theme/tokens.css` | ~25 CSS variables (rebrand surface) |
| `web/src/theme/tailwind.config.ts` | Maps tokens to utility classes |
| `web/src/lib/csrf.ts` | Reads `<meta name="scry-csrf">`, attaches `X-Scry-Csrf` header |
| `web/src/lib/api.ts` | `apiFetch(path, init)` — wraps fetch with CSRF + JSON error handling |
| `web/src/lib/sse.ts` | Typed SSE consumer (used in Plan B) |
| `tests/server/health.test.ts` | Server boot + health route |
| `tests/server/middleware/origin.test.ts` | Origin allowlist |
| `tests/server/middleware/csrf.test.ts` | CSRF require/reject |
| `tests/config/atomic-write.test.ts` | Atomic write happy path + crash mid-write |
| `tests/core/abort.test.ts` | `raceAbort` + AbortSignal threading |
| `package.json` | Add `hono`, `@hono/node-server`, `zod`, `open` runtime deps |

---

### Task 1: Create branch and scaffold `src/shared/types.ts`

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/web-foundation
git status
```

Expected: `On branch feat/web-foundation`. Pre-existing uncommitted changes (`.gitignore`, `CLAUDE.md`, `session-notes/`) are unrelated and stay untouched throughout this plan. Never stage them.

- [ ] **Step 2: Create `src/shared/types.ts`**

```typescript
// src/shared/types.ts
// Types referenced by both the Hono server and the React web app.
// Plan A populates this with the CSRF + error shapes; later plans will add SearchEvent, McpStatus, etc.

export interface CsrfBootstrap {
  token: string;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(shared): scaffold cross-cutting types"
```

---

### Task 2: Atomic config write helper

**Files:**
- Create: `src/config/atomic-write.ts`
- Create: `tests/config/atomic-write.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/config/atomic-write.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { atomicWriteConfig } from '../../src/config/atomic-write.js';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('atomicWriteConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scry-atomic-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes new file atomically when no existing file', async () => {
    const target = join(dir, 'scry.config.yaml');
    await atomicWriteConfig(target, 'hello: world\n');
    expect(readFileSync(target, 'utf-8')).toBe('hello: world\n');
    expect(existsSync(`${target}.bak`)).toBe(false);
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('backs up existing file before overwriting', async () => {
    const target = join(dir, 'scry.config.yaml');
    writeFileSync(target, 'old: content\n');
    await atomicWriteConfig(target, 'new: content\n');
    expect(readFileSync(target, 'utf-8')).toBe('new: content\n');
    expect(readFileSync(`${target}.bak`, 'utf-8')).toBe('old: content\n');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('overwrites prior .bak on subsequent writes', async () => {
    const target = join(dir, 'scry.config.yaml');
    writeFileSync(target, 'v1\n');
    await atomicWriteConfig(target, 'v2\n');
    await atomicWriteConfig(target, 'v3\n');
    expect(readFileSync(target, 'utf-8')).toBe('v3\n');
    expect(readFileSync(`${target}.bak`, 'utf-8')).toBe('v2\n');
  });

  it('leaves the live file intact if the write fails before rename', async () => {
    const target = join(dir, 'scry.config.yaml');
    writeFileSync(target, 'original\n');
    // Path that can't be written: a directory
    const badTarget = join(dir, 'a-dir');
    const fs = await import('fs/promises');
    await fs.mkdir(badTarget);
    await expect(atomicWriteConfig(badTarget, 'x')).rejects.toThrow();
    // Original target untouched
    expect(readFileSync(target, 'utf-8')).toBe('original\n');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/config/atomic-write.test.ts
```

Expected: 4 failing tests with "atomicWriteConfig is not a function" or import error.

- [ ] **Step 3: Implement**

```typescript
// src/config/atomic-write.ts
import { promises as fs } from 'fs';

/**
 * Atomic write with backup. Sequence:
 *   1. If the target exists, copy it to <path>.bak (overwriting any prior .bak).
 *   2. Write content to <path>.tmp, fsync, close.
 *   3. Rename <path>.tmp → <path> (atomic on POSIX).
 * On any failure before the rename, the live file is untouched.
 */
export async function atomicWriteConfig(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  const bak = `${path}.bak`;

  // Verify target's parent is a directory we can write to (catches the
  // "target IS a directory" case before we touch any files).
  const stat = await fs.stat(path).catch(() => null);
  if (stat && stat.isDirectory()) {
    throw new Error(`Cannot write config: ${path} is a directory`);
  }

  if (stat) {
    await fs.copyFile(path, bak);
  }

  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }

  await fs.rename(tmp, path);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/config/atomic-write.test.ts
```

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/atomic-write.ts tests/config/atomic-write.test.ts
git commit -m "feat(config): add atomicWriteConfig with .bak + tmp+fsync+rename"
```

---

### Task 3: AbortSignal threading helper + engine plumbing

**Files:**
- Create: `src/core/abort.ts`
- Create: `tests/core/abort.test.ts`
- Modify: `src/core/mcp-pool.ts` (add optional `signal` to `callTool`)
- Modify: `src/core/synthesizer.ts` (accept optional `signal`, pass to fetch)

- [ ] **Step 1: Write tests for `raceAbort`**

```typescript
// tests/core/abort.test.ts
import { describe, it, expect } from 'vitest';
import { raceAbort } from '../../src/core/abort.js';

describe('raceAbort', () => {
  it('resolves when the inner promise resolves first', async () => {
    const signal = new AbortController().signal;
    const result = await raceAbort(Promise.resolve(42), signal);
    expect(result).toBe(42);
  });

  it('rejects with AbortError when signal aborts first', async () => {
    const ctl = new AbortController();
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 1000));
    setTimeout(() => ctl.abort(), 10);
    await expect(raceAbort(slow, ctl.signal)).rejects.toThrow(/aborted/i);
  });

  it('rejects immediately if signal already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(raceAbort(Promise.resolve(1), ctl.signal)).rejects.toThrow(/aborted/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/core/abort.test.ts
```

Expected: 3 failing tests, import error.

- [ ] **Step 3: Implement `raceAbort`**

```typescript
// src/core/abort.ts
export class AbortError extends Error {
  constructor(message = 'Operation aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => { signal.removeEventListener('abort', onAbort); resolve(val); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); }
    );
  });
}
```

- [ ] **Step 4: Run tests to verify**

```bash
npm test -- tests/core/abort.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Thread `signal` through `McpPool.callTool`**

In `src/core/mcp-pool.ts`, find `callTool` and add an optional `signal` parameter. The MCP SDK's `client.callTool({...})` accepts a second arg with `signal`. Update the signature and pass it through.

```typescript
// In src/core/mcp-pool.ts, replace the existing callTool method with:
async callTool(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number = 15000,
  signal?: AbortSignal,
): Promise<unknown> {
  const serverName = this.toolToServer.get(toolName);
  if (!serverName) throw new Error(`Unknown tool: ${toolName}`);
  const conn = this.connections.get(serverName);
  if (!conn) throw new Error(`No connection for ${serverName}`);

  const callPromise = conn.client.callTool({ name: toolName, arguments: args }, undefined, { signal });
  return raceAbort(withTimeout(callPromise, timeoutMs), signal);
}
```

Add the import at the top: `import { raceAbort } from './abort.js';`

- [ ] **Step 6: Thread `signal` through `synthesize`**

In `src/core/synthesizer.ts`, find the function `synthesize` and add an optional `signal` parameter. The synthesizer makes a `fetch()` to the LLM endpoint — pass `signal` to fetch's init.

Read `src/core/synthesizer.ts` first to confirm the exact signature, then update:

```typescript
// signature change:
export async function synthesize(
  query: string,
  results: SearchResult[],
  llm: LlmConfig,
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  // ... existing body, find the fetch call and add `signal` to its init:
  // const response = await fetch(url, { method: 'POST', headers, body, signal });
}
```

- [ ] **Step 7: Run the full test suite**

```bash
npm run build && npm test
```

Expected: build clean, all tests pass (existing engine tests still green; abort tests new and passing).

- [ ] **Step 8: Commit**

```bash
git add src/core/abort.ts src/core/mcp-pool.ts src/core/synthesizer.ts tests/core/abort.test.ts
git commit -m "feat(core): thread AbortSignal through McpPool.callTool and synthesize"
```

---

### Task 4: Add server runtime dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Hono + node-server + zod + open**

```bash
npm install hono @hono/node-server zod open
npm install --save-dev @types/node
```

- [ ] **Step 2: Confirm `package.json` dependencies block looks correct**

Read `package.json`. Verify the `dependencies` section now contains `hono`, `@hono/node-server`, `zod`, `open` alongside whatever existed before. `@types/node` should be in `devDependencies`.

- [ ] **Step 3: Build to confirm no breakage**

```bash
npm run build && npm test
```

Expected: build clean, 99/99 (or whatever the current count is) passing.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add hono, @hono/node-server, zod, open"
```

---

### Task 5: Origin allowlist middleware + tests

**Files:**
- Create: `src/server/middleware/origin.ts`
- Create: `tests/server/middleware/origin.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/server/middleware/origin.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { originAllowlist } from '../../../src/server/middleware/origin.js';

function makeApp(port = 6678) {
  const app = new Hono();
  app.use('*', originAllowlist(port));
  app.get('/ok', (c) => c.json({ ok: true }));
  return app;
}

describe('originAllowlist', () => {
  it('accepts requests with no Origin (curl, server-side)', async () => {
    const app = makeApp();
    const res = await app.request('/ok', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('accepts http://localhost:6678', async () => {
    const app = makeApp();
    const res = await app.request('/ok', { headers: { Origin: 'http://localhost:6678' } });
    expect(res.status).toBe(200);
  });

  it('accepts http://127.0.0.1:6678', async () => {
    const app = makeApp();
    const res = await app.request('/ok', { headers: { Origin: 'http://127.0.0.1:6678' } });
    expect(res.status).toBe(200);
  });

  it('rejects http://evil.example.com', async () => {
    const app = makeApp();
    const res = await app.request('/ok', { headers: { Origin: 'http://evil.example.com' } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('origin-rejected');
  });

  it('rejects https://localhost:6678 (wrong scheme)', async () => {
    const app = makeApp();
    const res = await app.request('/ok', { headers: { Origin: 'https://localhost:6678' } });
    expect(res.status).toBe(403);
  });

  it('rejects http://localhost:9999 (wrong port)', async () => {
    const app = makeApp();
    const res = await app.request('/ok', { headers: { Origin: 'http://localhost:9999' } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/server/middleware/origin.test.ts
```

Expected: 6 failing tests (import error).

- [ ] **Step 3: Implement**

```typescript
// src/server/middleware/origin.ts
import type { MiddlewareHandler } from 'hono';

export function originAllowlist(port: number): MiddlewareHandler {
  const allowed = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
  ]);
  return async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !allowed.has(origin)) {
      return c.json({ error: 'origin-rejected', message: `Origin ${origin} not allowed` }, 403);
    }
    await next();
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/server/middleware/origin.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/origin.ts tests/server/middleware/origin.test.ts
git commit -m "feat(server): origin allowlist middleware"
```

---

### Task 6: CSRF token + middleware

**Files:**
- Create: `src/server/middleware/csrf-token.ts`
- Create: `src/server/middleware/csrf.ts`
- Create: `tests/server/middleware/csrf.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/server/middleware/csrf.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateCsrfToken, getCsrfToken, resetCsrfTokenForTests } from '../../../src/server/middleware/csrf-token.js';
import { csrfRequired } from '../../../src/server/middleware/csrf.js';

describe('csrf', () => {
  beforeEach(() => {
    resetCsrfTokenForTests();
    generateCsrfToken();
  });

  it('GET requests pass without a token', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.get('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x');
    expect(res.status).toBe(200);
  });

  it('POST without X-Scry-Csrf rejects 403', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.post('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('csrf-required');
  });

  it('POST with wrong X-Scry-Csrf rejects 403', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.post('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { method: 'POST', headers: { 'X-Scry-Csrf': 'wrong' } });
    expect(res.status).toBe(403);
  });

  it('POST with correct X-Scry-Csrf passes', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.post('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { method: 'POST', headers: { 'X-Scry-Csrf': getCsrfToken() } });
    expect(res.status).toBe(200);
  });

  it('PUT, PATCH, DELETE all require token', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.put('/x', (c) => c.json({}));
    app.patch('/x', (c) => c.json({}));
    app.delete('/x', (c) => c.json({}));
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/x', { method });
      expect(res.status).toBe(403);
    }
  });

  it('generateCsrfToken produces a 64-char hex string', () => {
    resetCsrfTokenForTests();
    generateCsrfToken();
    expect(getCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/server/middleware/csrf.test.ts
```

Expected: 6 failing tests (import error).

- [ ] **Step 3: Implement token store**

```typescript
// src/server/middleware/csrf-token.ts
import { randomBytes } from 'crypto';

let token: string | null = null;

export function generateCsrfToken(): string {
  token = randomBytes(32).toString('hex');
  return token;
}

export function getCsrfToken(): string {
  if (!token) throw new Error('CSRF token not initialized — call generateCsrfToken() at boot');
  return token;
}

// Test-only: clear the token between tests so generateCsrfToken can re-init.
export function resetCsrfTokenForTests(): void {
  token = null;
}
```

- [ ] **Step 4: Implement middleware**

```typescript
// src/server/middleware/csrf.ts
import type { MiddlewareHandler } from 'hono';
import { getCsrfToken } from './csrf-token.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfRequired(): MiddlewareHandler {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      await next();
      return;
    }
    const provided = c.req.header('X-Scry-Csrf');
    if (!provided || provided !== getCsrfToken()) {
      return c.json({ error: 'csrf-required', message: 'Missing or invalid X-Scry-Csrf header' }, 403);
    }
    await next();
  };
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/server/middleware/csrf.test.ts
```

Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add src/server/middleware/csrf.ts src/server/middleware/csrf-token.ts tests/server/middleware/csrf.test.ts
git commit -m "feat(server): per-boot CSRF token + middleware"
```

---

### Task 7: Hono server scaffold + health route + boot

**Files:**
- Create: `src/server/index.ts`
- Create: `src/server/boot.ts`
- Create: `src/server/routes/health.ts`
- Create: `src/server/routes/csrf.ts`
- Create: `tests/server/health.test.ts`

- [ ] **Step 1: Write tests for server scaffold**

```typescript
// tests/server/health.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../src/server/middleware/csrf-token.js';

describe('server scaffold', () => {
  beforeAll(() => {
    generateCsrfToken();
  });

  it('GET /api/health returns 200 with status ok', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/csrf returns the boot token', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/csrf');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(getCsrfToken());
  });

  it('rejects bad-origin requests on health route too', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/server/health.test.ts
```

Expected: failures, import error.

- [ ] **Step 3: Implement health and csrf routes**

```typescript
// src/server/routes/health.ts
import { Hono } from 'hono';

export const healthRoute = new Hono().get('/', (c) => c.json({ status: 'ok' }));
```

```typescript
// src/server/routes/csrf.ts
import { Hono } from 'hono';
import { getCsrfToken } from '../middleware/csrf-token.js';

export const csrfRoute = new Hono().get('/', (c) => c.json({ token: getCsrfToken() }));
```

- [ ] **Step 4: Implement server factory**

```typescript
// src/server/index.ts
import { Hono } from 'hono';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';

export interface ServerOptions {
  port: number;
}

export function createServer(opts: ServerOptions) {
  const app = new Hono();

  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());

  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);

  return app;
}
```

- [ ] **Step 5: Implement boot**

```typescript
// src/server/boot.ts
import { serve } from '@hono/node-server';
import { createServer } from './index.js';
import { generateCsrfToken } from './middleware/csrf-token.js';

export interface BootOptions {
  port: number;
}

export function startServer(opts: BootOptions) {
  generateCsrfToken();
  const app = createServer(opts);
  return serve({ fetch: app.fetch, port: opts.port, hostname: '127.0.0.1' });
}
```

- [ ] **Step 6: Run tests**

```bash
npm run build && npm test -- tests/server/
```

Expected: all server tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts src/server/boot.ts src/server/routes/health.ts src/server/routes/csrf.ts tests/server/health.test.ts
git commit -m "feat(server): Hono scaffold with health + csrf routes, origin + csrf middleware wired"
```

---

### Task 8: Vite + React + Tailwind scaffold in `web/`

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.node.json` (for vite.config)
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/theme/tokens.css`
- Create: `web/src/theme/tailwind.config.ts`
- Create: `web/src/index.css`
- Create: `web/postcss.config.js`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "scry-web",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Install web deps**

```bash
cd web && npm install && cd ..
```

Expected: clean install, no errors. Add `web/node_modules/` to `.gitignore` if not already covered (the existing `.gitignore` has `node_modules` which globs all subdirs).

- [ ] **Step 3: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src/shared'),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:6678',
        changeOrigin: false,
      },
    },
  },
});
```

- [ ] **Step 4: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../src/shared/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 5: Create `web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 6: Create `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="scry-csrf" content="__SCRY_CSRF__" />
    <title>scry</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

(The `__SCRY_CSRF__` placeholder is replaced by the static-file handler at request time. For Vite dev, the React app reads it via `/api/csrf` instead — see Task 9 lib.)

- [ ] **Step 7: Create theme tokens**

```css
/* web/src/theme/tokens.css */
:root {
  /* Backgrounds */
  --scry-bg-primary: #0c0e10;
  --scry-bg-secondary: #14171a;
  --scry-bg-sidebar: #0a0c0e;
  --scry-bg-elevated: #1c2024;

  /* Text */
  --scry-text-primary: #ecefe8;
  --scry-text-secondary: #b4bcb6;
  --scry-text-tertiary: #6e7770;

  /* Accent (scry's identity — cool teal, distinct from lynx amber) */
  --scry-accent: #3aa39c;
  --scry-accent-dim: #2a7a76;
  --scry-accent-glow: rgba(58, 163, 156, 0.18);

  /* Status */
  --scry-error: #d96363;
  --scry-warning: #d9a03a;
  --scry-success: #5ab07e;

  /* Borders + dividers */
  --scry-border: #232629;
  --scry-divider: #1a1d20;

  /* Typography */
  --scry-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --scry-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Sizes */
  --scry-radius-sm: 4px;
  --scry-radius-md: 8px;
  --scry-radius-lg: 12px;
}

[data-theme='light'] {
  --scry-bg-primary: #f8f9f7;
  --scry-bg-secondary: #eef0ec;
  --scry-bg-sidebar: #e6e8e3;
  --scry-bg-elevated: #ffffff;
  --scry-text-primary: #1a1d1f;
  --scry-text-secondary: #4a5052;
  --scry-text-tertiary: #7a8082;
  --scry-border: #d0d4d2;
  --scry-divider: #e0e3e0;
}
```

- [ ] **Step 8: Create Tailwind config**

```typescript
// web/src/theme/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--scry-bg-primary)',
          secondary: 'var(--scry-bg-secondary)',
          sidebar: 'var(--scry-bg-sidebar)',
          elevated: 'var(--scry-bg-elevated)',
        },
        text: {
          primary: 'var(--scry-text-primary)',
          secondary: 'var(--scry-text-secondary)',
          tertiary: 'var(--scry-text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--scry-accent)',
          dim: 'var(--scry-accent-dim)',
        },
        border: 'var(--scry-border)',
        divider: 'var(--scry-divider)',
        error: 'var(--scry-error)',
        warning: 'var(--scry-warning)',
        success: 'var(--scry-success)',
      },
      fontFamily: {
        sans: ['var(--scry-sans)'],
        mono: ['var(--scry-mono)'],
      },
      borderRadius: {
        sm: 'var(--scry-radius-sm)',
        DEFAULT: 'var(--scry-radius-md)',
        lg: 'var(--scry-radius-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
```

Note: Tailwind looks for `tailwind.config.{ts,js}` at the directory root by default. Move/rename this to `web/tailwind.config.ts` (top of `web/`, not under `src/theme/`). The `src/theme/` directory is for tokens.css only. Update the file path:

Actually, just put it at `web/tailwind.config.ts`. Update the file map and create it there:

```bash
mv web/src/theme/tailwind.config.ts web/tailwind.config.ts
```

(If you have not yet created the file in the wrong location, just create it directly at `web/tailwind.config.ts`.)

- [ ] **Step 9: Create PostCSS config and root CSS**

```javascript
// web/postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

```css
/* web/src/index.css */
@import './theme/tokens.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  background: var(--scry-bg-primary);
  color: var(--scry-text-primary);
  font-family: var(--scry-sans);
}
```

- [ ] **Step 10: Create React entry**

```typescript
// web/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

```typescript
// web/src/App.tsx
export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-sans text-text-primary mb-2">scry</h1>
        <p className="text-text-secondary">foundation ready — features land in subsequent plans</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Build the frontend**

```bash
cd web && npm run build && cd ..
ls -la dist/web/
```

Expected: `dist/web/` exists with `index.html`, `assets/*.js`, `assets/*.css`.

- [ ] **Step 12: Commit**

```bash
git add web/ dist/web/
git commit -m "feat(web): Vite + React + Tailwind scaffold with theme tokens"
```

(Note: `dist/web/` is committed for now to keep the foundation reproducible. Later plans may add it to `.gitignore` and rely on `npm run build`. For Plan A, having the build output committed simplifies the next task's static-serving wire-up.)

Actually — don't commit `dist/web/`. Add it to `.gitignore` instead. The pre-existing `.gitignore` already has `dist/` per the existing project structure. Verify:

```bash
grep -E "^dist" .gitignore || echo "NOT_GITIGNORED"
```

If `dist/` is gitignored, only `git add web/` is needed. The build output stays local and CI/install will re-run the build via the `prepublishOnly` hook.

```bash
git add web/
git commit -m "feat(web): Vite + React + Tailwind scaffold with theme tokens"
```

---

### Task 9: Frontend `lib/csrf.ts`, `lib/api.ts`, `lib/sse.ts`

**Files:**
- Create: `web/src/lib/csrf.ts`
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/sse.ts`

- [ ] **Step 1: Implement `lib/csrf.ts`**

```typescript
// web/src/lib/csrf.ts
// Reads the per-boot CSRF token. Two paths:
//   1. Production: index.html has <meta name="scry-csrf" content="<token>"> (server replaces __SCRY_CSRF__).
//   2. Vite dev: the placeholder is unchanged, so we fetch /api/csrf on first call.

let cached: string | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/csrf');
  if (!res.ok) throw new Error(`CSRF fetch failed: ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export async function getCsrfToken(): Promise<string> {
  if (cached) return cached;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="scry-csrf"]');
  const metaValue = meta?.content;

  if (metaValue && metaValue !== '__SCRY_CSRF__') {
    cached = metaValue;
    return cached;
  }

  cached = await fetchToken();
  return cached;
}
```

- [ ] **Step 2: Implement `lib/api.ts`**

```typescript
// web/src/lib/api.ts
import { getCsrfToken } from './csrf.js';
import type { ApiError } from '@shared/types.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();

  if (MUTATING.has(method)) {
    headers.set('X-Scry-Csrf', await getCsrfToken());
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(path, { ...init, method, headers });
}

export class ApiCallError extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.message ?? body.error);
    this.name = 'ApiCallError';
  }
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: `http-${res.status}` }));
    throw new ApiCallError(res.status, body);
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 3: Implement `lib/sse.ts`**

```typescript
// web/src/lib/sse.ts
// Minimal SSE consumer — used by Plan B's search route.
// Parses `event:`/`data:` blocks separated by blank lines.

export interface SseHandler<T> {
  onEvent: (event: T) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

export async function consumeSse<T>(
  res: Response,
  handler: SseHandler<T>,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) throw new Error('No response body for SSE');
  if (!res.headers.get('Content-Type')?.startsWith('text/event-stream')) {
    throw new Error('Response is not text/event-stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as T;
          handler.onEvent(parsed);
        } catch (err) {
          handler.onError?.(err as Error);
        }
      }
    }
    handler.onDone?.();
  } catch (err) {
    handler.onError?.(err as Error);
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd web && npm run build && cd ..
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/
git commit -m "feat(web): csrf, api, sse client libs"
```

---

### Task 10: Static file handler (with CSRF token injection) + `scry serve` CLI subcommand

**Files:**
- Create: `src/server/static.ts`
- Modify: `src/server/index.ts` (mount static handler)
- Modify: `src/cli.ts` (add `serve` subcommand)

- [ ] **Step 1: Implement static handler**

```typescript
// src/server/static.ts
import type { MiddlewareHandler } from 'hono';
import { promises as fs } from 'fs';
import { join, normalize } from 'path';
import { getCsrfToken } from './middleware/csrf-token.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const CSP =
  "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:";

export function staticHandler(rootDir: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();

    const urlPath = c.req.path === '/' ? '/index.html' : c.req.path;
    // SPA fallback: anything that doesn't have an extension and isn't /api/* gets index.html
    const isApi = urlPath.startsWith('/api/');
    if (isApi) return next();

    const hasExt = /\.[a-z0-9]+$/i.test(urlPath);
    const target = hasExt ? urlPath : '/index.html';
    const fsPath = normalize(join(rootDir, target));

    if (!fsPath.startsWith(normalize(rootDir))) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const ext = target.slice(target.lastIndexOf('.'));
    const mime = MIME[ext] ?? 'application/octet-stream';

    let content: Buffer | string;
    try {
      content = await fs.readFile(fsPath);
    } catch {
      return c.json({ error: 'not-found' }, 404);
    }

    if (target.endsWith('.html')) {
      content = content.toString('utf-8').replace('__SCRY_CSRF__', getCsrfToken());
    }

    return new Response(content, {
      headers: {
        'Content-Type': mime,
        'Content-Security-Policy': CSP,
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}
```

- [ ] **Step 2: Mount static handler in server**

Update `src/server/index.ts`:

```typescript
import { Hono } from 'hono';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';
import { staticHandler } from './static.js';

export interface ServerOptions {
  port: number;
  staticDir?: string;  // path to dist/web (resolved relative to dist/server at runtime)
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(opts: ServerOptions) {
  const app = new Hono();

  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());

  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);

  // Default staticDir: ../web (when running from dist/server). Caller can override.
  const staticDir = opts.staticDir ?? resolve(__dirname, '../web');
  app.use('*', staticHandler(staticDir));

  return app;
}
```

- [ ] **Step 3: Add `scry serve` to cli.ts**

In `src/cli.ts`, after the existing `program.command('init')` definition and before `program.parse()`, add:

```typescript
import open from 'open';

program
  .command('serve')
  .description('Start the scry web GUI on localhost')
  .option('-p, --port <number>', 'Port to listen on', '6678')
  .option('-c, --config <path>', 'Config file path')
  .option('--no-open', 'Skip opening the browser')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const { startServer } = await import('./server/boot.js');
    startServer({ port });
    const url = `http://127.0.0.1:${port}`;
    console.error(`⟐ scry web running at ${url}`);
    if (opts.open !== false) {
      await open(url);
    }
  });
```

Add `import open from 'open';` to the top alongside other imports.

- [ ] **Step 4: Build and smoke-test manually**

```bash
npm run build
cd web && npm run build && cd ..
node dist/cli.js serve --port 6678 --no-open &
SERVER_PID=$!
sleep 1
curl -s http://127.0.0.1:6678/api/health
curl -s http://127.0.0.1:6678/api/csrf
curl -sI http://127.0.0.1:6678/ | head -5
kill $SERVER_PID
```

Expected:
- `/api/health` returns `{"status":"ok"}`
- `/api/csrf` returns `{"token":"<64-char hex>"}`
- `/` returns HTML with `Content-Security-Policy` header set

- [ ] **Step 5: Commit**

```bash
git add src/server/static.ts src/server/index.ts src/cli.ts
git commit -m "feat(server,cli): static handler with CSP + CSRF injection; scry serve subcommand"
```

---

### Task 11: Update `package.json` scripts + `files` allowlist

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current `package.json` to confirm current state**

```bash
cat package.json | head -30
```

- [ ] **Step 2: Update `scripts` and add `files`**

In `package.json`, replace the current `scripts` and `files` blocks with:

```json
"scripts": {
  "build:server": "tsc",
  "build:web": "cd web && npm run build",
  "build": "npm run build:server && npm run build:web",
  "prepublishOnly": "npm run build",
  "dev:server": "tsc --watch",
  "dev:web": "cd web && npm run dev",
  "test": "vitest run",
  "test:watch": "vitest"
},
"files": [
  "dist",
  "README.md"
],
```

If a `dev` or `dev:server` script existed before, replace it with the above. Keep all other top-level fields intact.

- [ ] **Step 3: Verify build still works**

```bash
npm run build
ls dist/server/index.js dist/web/index.html
```

Expected: both files exist after the build.

- [ ] **Step 4: Verify `npm pack` ships only what we want**

```bash
npm pack --dry-run 2>&1 | grep -E "^npm notice " | head -40
```

Expected: only files under `dist/`, plus `README.md`, `package.json`, and `LICENSE` (if present). No `web/src`, no `node_modules`, no source files from `src/`, no `tests/`.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: build:server + build:web scripts; explicit files allowlist"
```

---

### Task 12: Push and open PR

**Files:** none (git only)

- [ ] **Step 1: Verify gh auth identity**

```bash
gh auth status 2>&1 | grep -E "(account|Active)" | head -4
```

If active account is not `aviralv`, switch:

```bash
gh auth switch --hostname github.com --user aviralv
```

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/web-foundation
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat: web frontend foundation (Plan A)" --body "$(cat <<'EOF'
## Summary

Plan A of the scry web frontend rollout. Establishes:

- **Server foundation** — Hono app at `127.0.0.1:6678`, scaffolded by `scry serve`
- **Security** — Origin allowlist + per-boot CSRF token + tight CSP
- **Engine plumbing** — `AbortSignal` threaded through `McpPool.callTool` and `synthesize`
- **Atomic config writes** — `atomicWriteConfig` (tmp + fsync + rename + .bak) ready for Plans B–E
- **React + Vite + Tailwind frontend** — empty SPA, theme tokens (cool teal accent, distinct from lynx amber), CSRF/api/sse client libs ready
- **`scry serve` subcommand** — boots the server and opens the browser

No feature surfaces yet — search, MCP CRUD, settings, and onboarding land in Plans B–E on top of this.

Spec: `docs/superpowers/specs/2026-05-21-scry-web-frontend-design.md`
Plan: `docs/superpowers/plans/2026-05-22-scry-web-foundation.md`

## Test plan

- [x] `npm test` — all unit tests pass (existing engine + new atomic-write, abort, origin, csrf, server scaffold, csrf-token tests)
- [x] `npm run build` — server tsc clean + web Vite build clean
- [x] `node dist/cli.js serve --port 6678 --no-open` boots; `curl /api/health` returns `{"status":"ok"}`; `curl /api/csrf` returns a 64-char hex token
- [x] Browser at `http://127.0.0.1:6678/` shows the empty SPA shell with the placeholder text
- [x] Cross-origin curl (`-H "Origin: http://evil.example.com"`) gets 403
- [x] POST without `X-Scry-Csrf` gets 403; with the boot token gets through
- [x] `npm pack --dry-run` shows only `dist/` and `README.md` — no `web/src/`, no source files
- [x] `scry "<query>"` (CLI) continues to work unchanged

## Out of scope (follow-up plans)

- Plan B: search route + UI (SSE end-to-end)
- Plan C: MCP manager (CRUD + atomic pool swap)
- Plan D: settings (config editor, redaction, env-var-only auth)
- Plan E: onboarding wizard
- Plan F: E2E Playwright smoke tests + npm publish hardening
EOF
)"
```

- [ ] **Step 4: Wait for review + sign-off before merge**

Per `DEPLOYMENT.md`: PRs are for review, not auto-merge. Don't merge until the user confirms.

---

## Self-Review

**Spec coverage:**
- Repo layout (`src/shared`, `src/server`, `web/`) → Tasks 1, 7, 8
- Atomic config writes → Task 2
- AbortSignal threading → Task 3
- Hono server + Origin + CSRF + CSP → Tasks 4, 5, 6, 7, 10
- Frontend scaffold + theme tokens → Task 8
- Frontend client libs (csrf, api, sse) → Task 9
- `scry serve` subcommand → Task 10
- `package.json` scripts + `files` allowlist → Task 11
- Branch + PR per `DEPLOYMENT.md` → Tasks 1, 12

Not in Plan A by design (covered in B–F): search route + UI, MCP CRUD, settings UI, onboarding wizard, E2E Playwright, npm publish.

**Placeholder scan:** No "TBD"s, no "TODO"s, no "implement later". Each step has its actual code or its actual command.

**Type consistency:**
- `getCsrfToken` is async on the client, sync on the server — these are different functions in different files (server/middleware/csrf-token.ts vs web/src/lib/csrf.ts). Same name is intentional and clear from import path.
- `ServerOptions` shape consistent across `createServer` and `startServer`.
- `ApiError`, `ApiResult` defined in `src/shared/types.ts`, used in `web/src/lib/api.ts` via `@shared/*` alias.
- `raceAbort` signature consistent across abort.ts and its call sites (mcp-pool, synthesizer).

Plan is ready for execution.
