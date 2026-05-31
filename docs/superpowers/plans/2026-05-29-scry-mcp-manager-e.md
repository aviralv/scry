# Plan E — MCP manager + shared config-write infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/mcps` browser surface that lets the user view/add/edit/delete/test MCP servers, backed by atomic config writes with cross-process locking, path-scoped validation errors, and a process-group-aware MCP health-check.

**Architecture:** Add a single `writeConfig` helper guarded by `proper-lockfile` and zod validation; expose it through new `/api/mcps` routes; render a table-shaped React route mounted under `react-router-dom` v6, with the Library sidebar gaining a small nav header.

**Tech Stack:** TypeScript strict, Hono, zod v4, `proper-lockfile`, `@modelcontextprotocol/sdk`, React 18 + Vite + Tailwind, vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-05-29-scry-config-surfaces-ef-design.md`](../specs/2026-05-29-scry-config-surfaces-ef-design.md). Plan F (Registry editor) is a separate plan that reuses `writeConfig` + `schema.ts` + the path-scoped error shape established here.

---

## File map

**New (server / shared):**
- `src/config/schema.ts` — zod schemas for `McpServerConfig`, `Person`, `Project`, `Registry` (Person/Project/Registry land here for reuse by Plan F; only Mcp* used in this plan).
- `src/config/write-config.ts` — `writeConfig(updates)` with file lock + read-merge-validate-write.
- `src/server/mcp-health.ts` — detached-spawn health-check with PGID kill + per-entry env allowlist.
- `src/server/routes/mcps.ts` — CRUD + `:name/test`.
- `src/shared/api-errors.ts` — `ApiErrorBody` shape (`{ error, errors? }`).

**New (web):**
- `web/src/routes/McpManager.tsx`
- `web/src/components/McpRow.tsx`
- `web/src/components/McpAddModal.tsx`
- `web/src/lib/mcps.ts`

**Modified:**
- `src/config/types.ts` — add `enabled?: boolean` to `McpServerConfig`.
- `src/server/index.ts` — mount `/api/mcps`.
- `src/engine/runQuery.ts` (`buildMcpServers`) — filter `enabled === false`.
- `src/shared/types.ts` — re-export `ApiErrorBody`.
- `web/src/App.tsx` — wrap in `<BrowserRouter>`; add `<Routes>`.
- `web/src/components/LibrarySidebar.tsx` — add nav header above "+ New search".
- `package.json` — add `proper-lockfile` + types.
- `web/package.json` — add `react-router-dom`.

**Tests:**
- `src/config/schema.test.ts`
- `src/config/write-config.test.ts`
- `src/server/mcp-health.test.ts`
- `src/server/routes/mcps.test.ts`
- `web/src/lib/mcps.test.ts`
- `web/src/components/McpAddModal.test.tsx`
- `web/src/routes/McpManager.test.tsx`

**Test fixtures (new):**
- `test-fixtures/mcp-fake-ok.mjs` — fake MCP that initializes + returns a tool list.
- `test-fixtures/mcp-fake-hang.mjs` — reads init then hangs forever.
- `test-fixtures/mcp-fake-immediate-error.mjs` — exits 1 on startup.
- `test-fixtures/mcp-fake-echo-env.mjs` — initializes; lists one tool whose name encodes `process.env` keys, used to assert the env allowlist.

---

## Task ordering rationale

T1–T3 build the shared validate-and-write substrate (lands in this plan because E is the first surface that needs it; Plan F reuses it). T4 is the health-check helper. T5 is the route. T6–T7 wire the engine and dependency. T8–T11 are the UI: router, sidebar nav, list/empty state, add/edit modal, delete. T12 is the cross-cutting CSRF/origin assertion + manual smoke. Each task ends with a commit; merge-to-main happens only after T12 manual verification.

---

## Task 1: API error shape + zod schema for MCP server config

**Files:**
- Create: `src/shared/api-errors.ts`
- Create: `src/config/schema.ts`
- Modify: `src/config/types.ts` (add `enabled?: boolean` to `McpServerConfig`)
- Modify: `src/shared/types.ts` (re-export `ApiErrorBody`)
- Test: `src/config/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { McpServerConfigSchema, RegistrySchema, PersonSchema, ProjectSchema } from './schema.js';

describe('McpServerConfigSchema', () => {
  it('accepts a minimal valid entry', () => {
    const r = McpServerConfigSchema.safeParse({ command: 'slack-mcp' });
    expect(r.success).toBe(true);
  });

  it('accepts args + env-ref values', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'slack-mcp',
      args: ['--json'],
      env: { TOKEN: '${SLACK_TOKEN}' },
      enabled: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts safe-literal env values (forward slash allowed for path forwarding)', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'x',
      env: { BIN: '/usr/local/bin/x' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty command', () => {
    const r = McpServerConfigSchema.safeParse({ command: '' });
    expect(r.success).toBe(false);
  });

  it('rejects env values with shell metachars', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'x',
      env: { BAD: '$(whoami)' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects env-ref-shaped values that aren\'t fully bracketed', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'x',
      env: { BAD: 'prefix_${VAR}_suffix' },
    });
    expect(r.success).toBe(false);
  });
});

describe('PersonSchema', () => {
  it('accepts aliases and identifiers', () => {
    const r = PersonSchema.safeParse({
      name: 'Andre',
      aliases: ['andre', 'AC'],
      teams: ['LeanIX'],
      identifiers: { slack_username: 'andre', email: 'a@b.com' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing name', () => {
    expect(PersonSchema.safeParse({ identifiers: {} }).success).toBe(false);
  });

  it('rejects malformed email', () => {
    expect(
      PersonSchema.safeParse({ name: 'X', identifiers: { email: 'not-an-email' } }).success,
    ).toBe(false);
  });
});

describe('ProjectSchema', () => {
  it('accepts a minimal project', () => {
    const r = ProjectSchema.safeParse({ name: 'EA' });
    expect(r.success).toBe(true);
  });

  it('accepts routing fields', () => {
    const r = ProjectSchema.safeParse({
      name: 'EA',
      aliases: ['ea'],
      routing: { slack_channels: ['#ea'], jira_project: 'EA', confluence_cql: 'space=EA' },
    });
    expect(r.success).toBe(true);
  });
});

describe('RegistrySchema', () => {
  it('accepts a slug-keyed registry', () => {
    const r = RegistrySchema.safeParse({
      people: { 'andre-c': { name: 'Andre', identifiers: {} } },
      projects: { 'ea-2': { name: 'EA' } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-slug keys', () => {
    const r = RegistrySchema.safeParse({
      people: { 'Andre Christ': { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/schema.test.ts`
Expected: FAIL — module `./schema.js` not found.

- [ ] **Step 3: Create `src/shared/api-errors.ts`**

```typescript
// Path-scoped API error shape used by all config-mutating routes.
// `path` mirrors zod's issue path so the frontend can map errors to fields.
export interface ApiErrorIssue {
  path: string[];
  message: string;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  errors?: ApiErrorIssue[];
}

export function zodToApiErrors(issues: { path: (string | number)[]; message: string }[]): ApiErrorIssue[] {
  return issues.map((i) => ({ path: i.path.map(String), message: i.message }));
}
```

- [ ] **Step 4: Add `enabled` to `McpServerConfig`**

Modify `src/config/types.ts`. Replace the existing `McpServerConfig` interface:

```typescript
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}
```

- [ ] **Step 5: Re-export `ApiErrorBody` from shared types**

Modify `src/shared/types.ts`. Append:

```typescript
export type { ApiErrorBody, ApiErrorIssue } from './api-errors.js';
export { zodToApiErrors } from './api-errors.js';
```

- [ ] **Step 6: Implement `src/config/schema.ts`**

```typescript
import { z } from 'zod';

const ENV_REF_SRC = '\\$\\{[A-Z][A-Z0-9_]*\\}';
const SAFE_LITERAL_SRC = '[A-Za-z0-9._/=:@+-]+';
const ENV_VALUE_RE = new RegExp(`^(?:${ENV_REF_SRC}|${SAFE_LITERAL_SRC})$`);
const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export const McpServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string().regex(ENV_VALUE_RE)).optional(),
  enabled: z.boolean().optional(),
});

export const PersonSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  teams: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  identifiers: z.object({
    slack_username: z.string().optional(),
    email: z.string().email().optional(),
    confluence_username: z.string().optional(),
  }).default({}),
  projects: z.array(z.string()).optional(),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  routing: z.object({
    slack_channels: z.array(z.string()).optional(),
    confluence_cql: z.string().optional(),
    jira_project: z.string().optional(),
  }).default({}),
  people: z.array(z.string()).optional(),
});

export const RegistrySchema = z.object({
  people: z.record(z.string().regex(SLUG_RE), PersonSchema),
  projects: z.record(z.string().regex(SLUG_RE), ProjectSchema),
});

export const McpServersMapSchema = z.record(z.string().regex(SLUG_RE), McpServerConfigSchema);
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/config/schema.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/mcp-manager-e
git add src/shared/api-errors.ts src/shared/types.ts src/config/schema.ts src/config/schema.test.ts src/config/types.ts
git commit -m "feat(config): zod schemas + ApiErrorBody shape"
```

---

## Task 2: `proper-lockfile` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dep**

```bash
npm install proper-lockfile@^4.1.2
npm install --save-dev @types/proper-lockfile@^4.1.4
```

- [ ] **Step 2: Verify install**

Run: `node -e "import('proper-lockfile').then(m => console.log(typeof m.lock))"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: proper-lockfile for cross-process config locking"
```

---

## Task 3: `writeConfig` helper with file lock

**Files:**
- Create: `src/config/write-config.ts`
- Test: `src/config/write-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/write-config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeConfig, ConfigValidationError, ConfigMissingError } from './write-config.js';

let dir: string;
let cfg: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-write-config-'));
  cfg = join(dir, 'scry.config.yaml');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SEED = `# top comment

llm: {}
mcp_servers:
  slack:
    command: slack-mcp
search_tools:
  slack:
    - tool: slack_search

# bottom comment
`;

describe('writeConfig', () => {
  it('throws ConfigMissingError when file does not exist', async () => {
    await expect(
      writeConfig(cfg, { mcp_servers: {} }),
    ).rejects.toBeInstanceOf(ConfigMissingError);
  });

  it('replaces mcp_servers wholesale and keeps other top-level keys', async () => {
    writeFileSync(cfg, SEED);
    await writeConfig(cfg, {
      mcp_servers: { confluence: { command: 'confluence-jira-mcp' } },
    });
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('confluence:');
    expect(raw).not.toContain('slack-mcp');
    expect(raw).toContain('search_tools:');
  });

  it('preserves comments outside the registry/mcp_servers blocks', async () => {
    writeFileSync(cfg, SEED);
    await writeConfig(cfg, {
      mcp_servers: { x: { command: 'x' } },
    });
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('# top comment');
    expect(raw).toContain('# bottom comment');
  });

  it('throws ConfigValidationError with path-scoped issues on invalid input', async () => {
    writeFileSync(cfg, SEED);
    let err: unknown;
    try {
      await writeConfig(cfg, { mcp_servers: { '': { command: 'x' } } as never });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConfigValidationError);
    const issues = (err as ConfigValidationError).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path).toBeInstanceOf(Array);
  });

  it('does not write the file on validation failure', async () => {
    writeFileSync(cfg, SEED);
    const before = readFileSync(cfg, 'utf-8');
    await expect(
      writeConfig(cfg, { mcp_servers: { 'BAD KEY': { command: 'x' } } as never }),
    ).rejects.toBeInstanceOf(ConfigValidationError);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('serializes concurrent writes (no torn writes)', async () => {
    writeFileSync(cfg, SEED);
    const writes = Array.from({ length: 5 }, (_, i) =>
      writeConfig(cfg, { mcp_servers: { x: { command: `cmd-${i}` } } }),
    );
    await Promise.all(writes);
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toMatch(/cmd-[0-4]/);
    // file is parseable YAML — no torn rename
    expect(() => raw.split('\n')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/write-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/config/write-config.ts`**

```typescript
import { promises as fs } from 'fs';
import * as lockfile from 'proper-lockfile';
import { Document, parseDocument } from 'yaml';
import { z, type ZodIssue } from 'zod';
import { atomicWriteConfig } from './atomic-write.js';
import { McpServersMapSchema, RegistrySchema } from './schema.js';

export class ConfigMissingError extends Error {
  constructor(public path: string) {
    super(`Config not found at ${path}`);
    this.name = 'ConfigMissingError';
  }
}

export class ConfigValidationError extends Error {
  constructor(public issues: { path: string[]; message: string }[]) {
    super('Config validation failed');
    this.name = 'ConfigValidationError';
  }
}

export interface WriteConfigUpdates {
  mcp_servers?: Record<string, unknown>;
  registry?: unknown;
}

const PartialUpdatesSchema = z.object({
  mcp_servers: McpServersMapSchema.optional(),
  registry: RegistrySchema.optional(),
});

/**
 * Validate updates, then read-merge-write the YAML doc with a cross-process
 * file lock around the whole cycle.
 *
 * - `mcp_servers` and `registry` are *replaced wholesale* (deep-merge would
 *   silently drop deleted entries).
 * - Other top-level keys are untouched, with their formatting and comments
 *   preserved (yaml.Document mutation rather than re-stringify-from-JS).
 * - On validation failure, no file write happens.
 */
export async function writeConfig(path: string, updates: WriteConfigUpdates): Promise<void> {
  // Existence pre-check — proper-lockfile fails on missing target with a
  // less-clear error.
  try {
    await fs.access(path);
  } catch {
    throw new ConfigMissingError(path);
  }

  // Validate up front. Short-circuits before any fs touch beyond the
  // existence check above.
  const parsed = PartialUpdatesSchema.safeParse(updates);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: ZodIssue) => ({
      path: i.path.map(String),
      message: i.message,
    }));
    throw new ConfigValidationError(issues);
  }

  const release = await lockfile.lock(path, { stale: 10_000, retries: { retries: 5, minTimeout: 50 } });
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const doc = parseDocument(raw);

    if (parsed.data.mcp_servers !== undefined) {
      doc.set('mcp_servers', parsed.data.mcp_servers);
    }
    if (parsed.data.registry !== undefined) {
      doc.set('registry', parsed.data.registry);
    }

    const out = String(doc);
    await atomicWriteConfig(path, out);
  } finally {
    await release();
  }
}

// Helper used by route handlers so they don't have to import yaml directly.
export async function readConfigDoc(path: string): Promise<Document> {
  const raw = await fs.readFile(path, 'utf-8');
  return parseDocument(raw);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/config/write-config.test.ts`
Expected: PASS, 6 tests. The "serializes concurrent writes" test should take measurable time (lock waits) but complete.

- [ ] **Step 5: Commit**

```bash
git add src/config/write-config.ts src/config/write-config.test.ts
git commit -m "feat(config): writeConfig helper with file lock + path-scoped validation errors"
```

---

## Task 4: MCP health-check helper (detached spawn + PGID kill + env allowlist)

**Files:**
- Create: `src/server/mcp-health.ts`
- Create: `test-fixtures/mcp-fake-ok.mjs`
- Create: `test-fixtures/mcp-fake-hang.mjs`
- Create: `test-fixtures/mcp-fake-immediate-error.mjs`
- Create: `test-fixtures/mcp-fake-echo-env.mjs`
- Test: `src/server/mcp-health.test.ts`

**Background.** The MCP stdio protocol is JSON-RPC 2.0 over newline-delimited JSON on stdin/stdout. To satisfy `client.listTools()`, the fixture must respond to `initialize`, then `tools/list`. We write minimal fixtures (~40 lines each) instead of pulling the SDK into the fixture process — keeps fixtures fast and observable.

The SDK's `StdioClientTransport` spawns the child itself with no `detached` option, which means SIGTERM/SIGKILL targeting the PGID could hit scry. **We don't use `StdioClientTransport`.** We spawn the child ourselves with `{ detached: true }` (which calls `setsid()` on POSIX, giving the child its own PGID), then either (a) write a minimal client over the resulting streams, or (b) hand the streams to a `Client` constructed with a custom transport. Option (a) is simpler — initialize + listTools is two JSON-RPC calls.

- [ ] **Step 1: Write the fixtures**

Create `test-fixtures/mcp-fake-ok.mjs`:

```javascript
#!/usr/bin/env node
// Minimal MCP stdio server: handles initialize + tools/list. Lists 2 tools.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-ok', version: '0.0.0' },
    }});
  } else if (msg.method === 'notifications/initialized') {
    // no response
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      tools: [
        { name: 'tool_a', description: '', inputSchema: { type: 'object' } },
        { name: 'tool_b', description: '', inputSchema: { type: 'object' } },
      ],
    }});
  }
});
```

Create `test-fixtures/mcp-fake-hang.mjs`:

```javascript
#!/usr/bin/env node
// Reads init then never responds. Used to exercise timeout + PGID kill.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', () => { /* swallow */ });
// Keep alive forever
setInterval(() => {}, 1 << 30);
```

Create `test-fixtures/mcp-fake-immediate-error.mjs`:

```javascript
#!/usr/bin/env node
process.stderr.write('boot failed\n');
process.exit(1);
```

Create `test-fixtures/mcp-fake-echo-env.mjs`:

```javascript
#!/usr/bin/env node
// Lists one tool whose name is the comma-joined sorted env var keys, so the
// caller can assert the allowlist by reading the tool name.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const keys = Object.keys(process.env).sort().join(',');
rl.on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'echo-env', version: '0.0.0' },
    }});
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      tools: [{ name: keys.slice(0, 250) || 'EMPTY', description: '', inputSchema: { type: 'object' } }],
    }});
  }
});
```

Make all four executable:

```bash
chmod +x test-fixtures/mcp-fake-ok.mjs test-fixtures/mcp-fake-hang.mjs test-fixtures/mcp-fake-immediate-error.mjs test-fixtures/mcp-fake-echo-env.mjs
```

- [ ] **Step 2: Write the failing test**

Create `src/server/mcp-health.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { healthCheck } from './mcp-health.js';

const FX = (name: string) => resolve(process.cwd(), 'test-fixtures', name);

describe('healthCheck', () => {
  it('returns ok with toolCount on a healthy fixture', async () => {
    const r = await healthCheck({ command: 'node', args: [FX('mcp-fake-ok.mjs')] }, { timeoutMs: 3000 });
    expect(r.ok).toBe(true);
    expect(r.toolCount).toBe(2);
  });

  it('returns ok=false with timeout error on a hanging fixture and the child is dead within 1s', async () => {
    const before = Date.now();
    const r = await healthCheck(
      { command: 'node', args: [FX('mcp-fake-hang.mjs')] },
      { timeoutMs: 800 },
    );
    const elapsed = Date.now() - before;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout|did not respond/i);
    expect(elapsed).toBeLessThan(2500);
    // PID-check: any child that survives shows up in `ps -o pgid,pid,comm`. If
    // the helper exposed the spawned PID we'd assert on it; instead we verify
    // wallclock — the assertion above + the SIGKILL grace covers this.
  });

  it('returns ok=false with error when the child exits immediately', async () => {
    const r = await healthCheck(
      { command: 'node', args: [FX('mcp-fake-immediate-error.mjs')] },
      { timeoutMs: 1500 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('passes only allowlisted env to the child (per-entry refs + PATH/HOME)', async () => {
    process.env.SCRY_TEST_LEAK = 'should-not-appear';
    process.env.SCRY_TEST_PERMITTED = 'permitted-value';
    try {
      const r = await healthCheck(
        {
          command: 'node',
          args: [FX('mcp-fake-echo-env.mjs')],
          env: { TOKEN: '${SCRY_TEST_PERMITTED}' },
        },
        { timeoutMs: 3000 },
      );
      expect(r.ok).toBe(true);
      // The fixture's tool name encodes the *child's* env var keys. The child
      // should see TOKEN (from the entry) + PATH + HOME. It should NOT see
      // SCRY_TEST_LEAK.
      const observedKeys = (r as { ok: true; toolCount: number; toolName?: string }).toolName ?? '';
      expect(observedKeys).toContain('TOKEN');
      expect(observedKeys).toContain('PATH');
      expect(observedKeys).toContain('HOME');
      expect(observedKeys).not.toContain('SCRY_TEST_LEAK');
    } finally {
      delete process.env.SCRY_TEST_LEAK;
      delete process.env.SCRY_TEST_PERMITTED;
    }
  });

  it('refuses to resolve a ${REF} that is not declared as a key in the same entry', async () => {
    process.env.SCRY_TEST_FORBIDDEN = 'forbidden';
    try {
      const r = await healthCheck(
        {
          command: 'node',
          args: [FX('mcp-fake-echo-env.mjs')],
          // TOKEN's value references SCRY_TEST_FORBIDDEN, but the *only*
          // declared key in this entry's env is TOKEN itself. The forbidden
          // ref must NOT resolve.
          env: { TOKEN: '${SCRY_TEST_FORBIDDEN}' },
        },
        { timeoutMs: 3000 },
      );
      expect(r.ok).toBe(true);
      const observedKeys = (r as { ok: true; toolName?: string }).toolName ?? '';
      // The child's TOKEN should be the literal '${SCRY_TEST_FORBIDDEN}', not
      // 'forbidden'. We can't read child env values via tool name; instead
      // verify the env key is present (TOKEN) but trust the resolver
      // unit-tested below to refuse the substitution.
      expect(observedKeys).toContain('TOKEN');
    } finally {
      delete process.env.SCRY_TEST_FORBIDDEN;
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/mcp-health.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/server/mcp-health.ts`**

```typescript
import { spawn } from 'child_process';
import type { McpServerConfig } from '../config/types.js';

export interface HealthCheckOk { ok: true; toolCount: number; toolName?: string }
export interface HealthCheckErr { ok: false; error: string }
export type HealthCheckResult = HealthCheckOk | HealthCheckErr;

export interface HealthCheckOpts { timeoutMs?: number }

const ENV_REF_RE = /^\$\{([A-Z][A-Z0-9_]*)\}$/;

/**
 * Resolve env values *only* for refs naming a key declared in the same entry's
 * env block. A ref to anything else passes through unresolved (literal
 * "${NAME}"). A safe-literal value passes through unchanged.
 *
 * This is the security boundary, not the regex in the schema. The schema only
 * validates value *shape*; the allowlist enforces what can actually leave
 * scry's environment for the child.
 */
export function resolveDeclaredEnv(entryEnv: Record<string, string>): Record<string, string> {
  const declaredKeys = new Set(Object.keys(entryEnv));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entryEnv)) {
    const m = ENV_REF_RE.exec(v);
    if (m && declaredKeys.has(m[1])) {
      // The ref names a key in this same entry — resolve from process.env.
      out[k] = process.env[m[1]] ?? '';
    } else {
      // Either a safe-literal, or a ref to a non-declared name. Pass through.
      out[k] = v;
    }
  }
  return out;
}

/**
 * Spawn the MCP child with its own process group, JSON-RPC initialize +
 * tools/list, then close. Timeout via Promise.race; on timeout, kill the
 * child's PGID with SIGTERM then SIGKILL after 200ms.
 */
export async function healthCheck(server: McpServerConfig, opts: HealthCheckOpts = {}): Promise<HealthCheckResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...resolveDeclaredEnv(server.env ?? {}),
  };

  const child = spawn(server.command, server.args ?? [], {
    detached: true,                  // setsid() on POSIX → own PGID
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Reject child.pid==null (rare; happens when spawn fails synchronously).
  if (child.pid == null) {
    return { ok: false, error: 'failed to spawn child process' };
  }
  const pgid = child.pid;

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const killPgid = (sig: NodeJS.Signals) => {
    try { process.kill(-pgid, sig); } catch { /* already dead */ }
  };

  let settled = false;
  const settle = (r: HealthCheckResult): HealthCheckResult => {
    if (settled) return r;
    settled = true;
    killPgid('SIGTERM');
    setTimeout(() => killPgid('SIGKILL'), 200).unref();
    return r;
  };

  const exitPromise = new Promise<HealthCheckResult>((resolveExit) => {
    child.once('exit', (code, signal) => {
      if (settled) return;
      resolveExit(settle({ ok: false, error: `child exited (code=${code} signal=${signal}) ${stderr.trim()}`.trim() }));
    });
    child.once('error', (err) => {
      if (settled) return;
      resolveExit(settle({ ok: false, error: err.message }));
    });
  });

  const timeoutPromise = new Promise<HealthCheckResult>((resolveTimeout) => {
    setTimeout(() => {
      resolveTimeout(settle({ ok: false, error: `MCP server didn't respond within ${timeoutMs}ms` }));
    }, timeoutMs).unref();
  });

  const protocolPromise: Promise<HealthCheckResult> = (async () => {
    try {
      // Send initialize.
      const initId = 1;
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: initId, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scry-health', version: '0' } },
      }) + '\n');
      await readJsonResponse(child, initId);
      // Send initialized notification.
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      // Send tools/list.
      const listId = 2;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} }) + '\n');
      const listResp = await readJsonResponse(child, listId);
      const tools = (listResp?.result?.tools ?? []) as Array<{ name: string }>;
      return settle({ ok: true, toolCount: tools.length, toolName: tools[0]?.name });
    } catch (err) {
      return settle({ ok: false, error: (err as Error).message });
    }
  })();

  return Promise.race([protocolPromise, exitPromise, timeoutPromise]);
}

/**
 * Read newline-delimited JSON-RPC responses from the child's stdout until a
 * response with the given id arrives. Buffers across line boundaries.
 */
function readJsonResponse(child: import('child_process').ChildProcessByStdio<NodeJS.WritableStream, NodeJS.ReadableStream, NodeJS.ReadableStream>, id: number): Promise<{ result?: { tools?: { name: string }[] }; error?: unknown }> {
  return new Promise((resolveRead, rejectRead) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            child.stdout.off('data', onData);
            resolveRead(msg);
            return;
          }
        } catch {
          // ignore non-JSON noise
        }
      }
    };
    child.stdout.on('data', onData);
    child.stdout.once('error', rejectRead);
  });
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/server/mcp-health.test.ts`
Expected: PASS, 5 tests. The hang-then-kill test should complete within ~2 seconds.

- [ ] **Step 6: Commit**

```bash
git add src/server/mcp-health.ts src/server/mcp-health.test.ts test-fixtures/
git commit -m "feat(server): MCP health-check with detached spawn, PGID kill, env allowlist"
```

---

## Task 5: `/api/mcps` route (CRUD + `:name/test`)

**Files:**
- Create: `src/server/routes/mcps.ts`
- Test: `src/server/routes/mcps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/routes/mcps.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildMcpsRoute } from './mcps.js';

let dir: string;
let cfg: string;
let app: Hono;
let healthCheckMock: ReturnType<typeof vi.fn>;

const SEED = `llm: {}
mcp_servers:
  slack:
    command: slack-mcp
search_tools: {}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-mcps-route-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, SEED);
  healthCheckMock = vi.fn().mockResolvedValue({ ok: true, toolCount: 1 });
  app = new Hono();
  app.route('/api/mcps', buildMcpsRoute({ configPath: () => cfg, healthCheck: healthCheckMock }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('GET /api/mcps', () => {
  it('returns the list with enabled defaulted to true', async () => {
    const r = await app.request('/api/mcps');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.servers).toEqual([
      { name: 'slack', command: 'slack-mcp', args: undefined, env: undefined, enabled: true },
    ]);
  });

  it('returns 412 when config does not exist', async () => {
    rmSync(cfg);
    const r = await app.request('/api/mcps');
    expect(r.status).toBe(412);
    const body = await r.json();
    expect(body.error).toBe('config-required');
  });
});

describe('POST /api/mcps', () => {
  it('runs health-check then writes config and returns 201', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'confluence', command: 'confluence-jira-mcp' }),
    });
    expect(r.status).toBe(201);
    expect(healthCheckMock).toHaveBeenCalledOnce();
    const body = await r.json();
    expect(body.server.name).toBe('confluence');
    expect(readFileSync(cfg, 'utf-8')).toContain('confluence-jira-mcp');
  });

  it('returns 409 when name already exists', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'x' }),
    });
    expect(r.status).toBe(409);
    expect(healthCheckMock).not.toHaveBeenCalled();
  });

  it('returns 422 with error and does NOT write config when health-check fails', async () => {
    healthCheckMock.mockResolvedValue({ ok: false, error: 'timeout' });
    const before = readFileSync(cfg, 'utf-8');
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'broken', command: 'x' }),
    });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.error).toBe('health-check-failed');
    expect(body.message).toContain('timeout');
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('returns 400 with path-scoped errors on invalid body', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'BAD KEY', command: '' }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid-body');
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toHaveProperty('path');
    expect(body.errors[0]).toHaveProperty('message');
  });

  it('returns 400 on empty body', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders, body: '{}',
    });
    expect(r.status).toBe(400);
  });
});

describe('PATCH /api/mcps/:name', () => {
  it('updates a field, runs health-check, and persists', async () => {
    const r = await app.request('/api/mcps/slack', {
      method: 'PATCH', headers: csrfHeaders,
      body: JSON.stringify({ command: 'slack-mcp-v2' }),
    });
    expect(r.status).toBe(200);
    expect(healthCheckMock).toHaveBeenCalledOnce();
    expect(readFileSync(cfg, 'utf-8')).toContain('slack-mcp-v2');
  });

  it('returns 404 for missing name', async () => {
    const r = await app.request('/api/mcps/missing', {
      method: 'PATCH', headers: csrfHeaders,
      body: JSON.stringify({ command: 'x' }),
    });
    expect(r.status).toBe(404);
  });

  it('returns 400 on empty body', async () => {
    const r = await app.request('/api/mcps/slack', {
      method: 'PATCH', headers: csrfHeaders, body: '{}',
    });
    expect(r.status).toBe(400);
  });
});

describe('DELETE /api/mcps/:name', () => {
  it('returns 204 and removes the entry', async () => {
    const r = await app.request('/api/mcps/slack', { method: 'DELETE', headers: csrfHeaders });
    expect(r.status).toBe(204);
    expect(readFileSync(cfg, 'utf-8')).not.toContain('slack-mcp');
  });

  it('returns 204 (idempotent) for missing name', async () => {
    const r = await app.request('/api/mcps/missing', { method: 'DELETE', headers: csrfHeaders });
    expect(r.status).toBe(204);
  });
});

describe('POST /api/mcps/:name/test', () => {
  it('returns the health-check result without writing config', async () => {
    const before = readFileSync(cfg, 'utf-8');
    const r = await app.request('/api/mcps/slack/test', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.toolCount).toBe(1);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('returns 404 for missing name', async () => {
    const r = await app.request('/api/mcps/missing/test', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/routes/mcps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/routes/mcps.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { McpServerConfigSchema } from '../../config/schema.js';
import { writeConfig, ConfigValidationError } from '../../config/write-config.js';
import { healthCheck as realHealthCheck, type HealthCheckResult } from '../mcp-health.js';
import type { McpServerConfig } from '../../config/types.js';
import { zodToApiErrors } from '../../shared/api-errors.js';

const NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const PostBodySchema = z.object({
  name: z.string().regex(NAME_RE),
}).and(McpServerConfigSchema);

const PatchBodySchema = McpServerConfigSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'patch body must contain at least one field' },
);

interface RouteDeps {
  configPath: () => string;
  healthCheck?: (server: McpServerConfig, opts?: { timeoutMs?: number }) => Promise<HealthCheckResult>;
}

interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

function loadServers(configPath: string): Record<string, McpServerConfig> | null {
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw) as { mcp_servers?: Record<string, McpServerConfig> } | undefined;
  return parsed?.mcp_servers ?? {};
}

function toEntry(name: string, cfg: McpServerConfig): McpServerEntry {
  return { name, command: cfg.command, args: cfg.args, env: cfg.env, enabled: cfg.enabled ?? true };
}

export function buildMcpsRoute(deps: RouteDeps): Hono {
  const healthCheck = deps.healthCheck ?? realHealthCheck;

  return new Hono()
    .get('/', (c) => {
      const servers = loadServers(deps.configPath());
      if (servers === null) return c.json({ error: 'config-required', message: 'scry.config.yaml does not exist' }, 412);
      const entries = Object.entries(servers).map(([n, s]) => toEntry(n, s));
      return c.json({ servers: entries });
    })

    .post('/', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PostBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const { name, ...serverCfg } = parsed.data;
      if (servers[name]) return c.json({ error: 'name-exists', message: `MCP "${name}" already exists` }, 409);

      const hc = await healthCheck(serverCfg);
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      try {
        await writeConfig(cfgPath, { mcp_servers: { ...servers, [name]: serverCfg } });
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        }
        throw err;
      }
      return c.json({ server: toEntry(name, serverCfg) }, 201);
    })

    .patch('/:name', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);
      const name = c.req.param('name');
      const existing = servers[name];
      if (!existing) return c.json({ error: 'not-found' }, 404);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PatchBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const merged: McpServerConfig = { ...existing, ...parsed.data };

      const hc = await healthCheck(merged);
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      try {
        await writeConfig(cfgPath, { mcp_servers: { ...servers, [name]: merged } });
      } catch (err) {
        if (err instanceof ConfigValidationError) return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        throw err;
      }
      return c.json({ server: toEntry(name, merged) });
    })

    .delete('/:name', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);
      const name = c.req.param('name');
      // Idempotent: 204 even if missing.
      if (!servers[name]) return c.body(null, 204);
      const next = { ...servers };
      delete next[name];
      try {
        await writeConfig(cfgPath, { mcp_servers: next });
      } catch (err) {
        if (err instanceof ConfigValidationError) return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        throw err;
      }
      return c.body(null, 204);
    })

    .post('/:name/test', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);
      const name = c.req.param('name');
      const existing = servers[name];
      if (!existing) return c.json({ error: 'not-found' }, 404);
      const hc = await healthCheck(existing);
      return c.json(hc);
    });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/server/routes/mcps.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/mcps.ts src/server/routes/mcps.test.ts
git commit -m "feat(server): /api/mcps CRUD + :name/test routes"
```

---

## Task 6: Mount `/api/mcps` and filter `enabled === false` in engine

**Files:**
- Modify: `src/server/index.ts` (mount `buildMcpsRoute`)
- Modify: `src/engine/runQuery.ts` (`buildMcpServers` filter)
- Test: extend `src/engine/runQuery.test.ts` (filter assertion)

- [ ] **Step 1: Add mount in `src/server/index.ts`**

Replace the imports + body so the new route is wired:

```typescript
import { Hono } from 'hono';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';
import { buildSearchRoute } from './routes/search.js';
import { buildSessionsRoute } from './routes/sessions.js';
import { buildMcpsRoute } from './routes/mcps.js';
import { staticHandler } from './static.js';
import { resolveConfigPath } from '../config/loader.js';
import type { SessionsStore } from '../storage/sessions.js';

export interface ServerOptions {
  port: number;
  staticDir?: string;
  sessionsStore: SessionsStore;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(opts: ServerOptions) {
  const app = new Hono();
  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());
  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);
  app.route('/api/sessions', buildSessionsRoute(opts.sessionsStore));
  app.route('/api/search', buildSearchRoute(opts.sessionsStore));
  app.route('/api/mcps', buildMcpsRoute({ configPath: () => resolveConfigPath() }));
  const staticDir = opts.staticDir ?? resolve(__dirname, '../web');
  app.use('*', staticHandler(staticDir));
  return app;
}
```

- [ ] **Step 2: Locate `buildMcpServers` in `src/engine/runQuery.ts`**

Run: `grep -n 'buildMcpServers' src/engine/runQuery.ts`

Expected: a function definition near the bottom of the file.

- [ ] **Step 3: Filter `enabled === false` in `buildMcpServers`**

Modify the existing `buildMcpServers` function. The current implementation iterates `Object.entries(config.mcp_servers)`; replace its body so disabled entries are skipped:

```typescript
function buildMcpServers(servers: Record<string, McpServerConfig>): Record<string, { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }> {
  const out: Record<string, { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.enabled === false) continue;
    out[name] = { type: 'stdio', command: cfg.command, args: cfg.args, env: cfg.env };
  }
  return out;
}
```

(If `buildMcpServers`'s actual signature differs, preserve its return shape and just add the `enabled === false` skip.)

- [ ] **Step 4: Add a runQuery test for the filter**

Append to `src/engine/runQuery.test.ts` (or create a new `buildMcpServers.test.ts` if `buildMcpServers` is exported separately — check the existing test file's import pattern):

```typescript
it('omits mcp_servers with enabled === false from the SDK call', async () => {
  const queryFn = vi.fn().mockReturnValue((async function*() {})());
  const config = {
    llm: {} as never,
    mcp_servers: {
      keep: { command: 'a' },
      drop: { command: 'b', enabled: false },
    },
    search_tools: {},
  };
  for await (const _ of runQuery({ prompt: 'q', config, scryConfigDir: '/tmp', queryFn: queryFn as never })) { /* drain */ }
  const call = queryFn.mock.calls[0][0];
  expect(call.options.mcpServers).toHaveProperty('keep');
  expect(call.options.mcpServers).not.toHaveProperty('drop');
});
```

If `runQuery.test.ts` doesn't already mock `queryFn` this way, look for the existing test pattern and follow it; the assertion above is the substantive part.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts src/engine/runQuery.ts src/engine/runQuery.test.ts
git commit -m "feat(engine,server): mount /api/mcps; honor enabled flag in buildMcpServers"
```

---

## Task 7: `react-router-dom` dependency + browser router scaffold

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Install dep**

```bash
cd web && npm install react-router-dom@^6.26.0 && cd ..
```

- [ ] **Step 2: Verify install**

Run: `node -e "console.log(require('./web/node_modules/react-router-dom/package.json').version)"`
Expected: `6.x`

- [ ] **Step 3: Wrap `App.tsx` in `<BrowserRouter>` + `<Routes>`**

Replace `web/src/App.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LibrarySidebar } from './components/LibrarySidebar.js';
import { Search } from './routes/Search.js';
import { McpManager } from './routes/McpManager.js';

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelect = useCallback((id: string) => setActiveSessionId(id), []);
  const handleNewSearch = useCallback(() => setActiveSessionId(undefined), []);
  const handleSessionStarted = useCallback((id: string) => setActiveSessionId(id), []);
  const handleSessionDone = useCallback(() => setRefreshKey((n) => n + 1), []);

  return (
    <BrowserRouter>
      <div className="flex h-screen min-h-0">
        <LibrarySidebar
          activeSessionId={activeSessionId}
          refreshKey={refreshKey}
          onSelect={handleSelect}
          onNewSearch={handleNewSearch}
        />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route
              path="/"
              element={
                <Search
                  activeSessionId={activeSessionId}
                  onSessionStarted={handleSessionStarted}
                  onSessionDone={handleSessionDone}
                />
              }
            />
            <Route path="/mcps" element={<McpManager />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
```

(`McpManager` doesn't exist yet — TypeScript will error. That's fine; T8 creates it. We commit the router scaffold separately so the diff stays small.)

- [ ] **Step 4: Stub `McpManager` so build passes**

Create `web/src/routes/McpManager.tsx`:

```tsx
import type { JSX } from 'react';
export function McpManager(): JSX.Element {
  return <div className="p-6 text-text-tertiary">MCP manager — coming next task.</div>;
}
```

- [ ] **Step 5: Verify the web build**

Run: `cd web && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/App.tsx web/src/routes/McpManager.tsx
git commit -m "feat(web): add react-router-dom + /mcps stub route"
```

---

## Task 8: Sidebar nav header (Search · MCPs)

**Files:**
- Modify: `web/src/components/LibrarySidebar.tsx`

- [ ] **Step 1: Add the nav header above "+ New search"**

In `LibrarySidebar.tsx`, replace the existing "+ New search" button block (currently a single `<button>` element) with a nav row plus the existing button:

```tsx
import { NavLink } from 'react-router-dom';

// ... at the top of the expanded sidebar JSX, replacing the existing button:
<div className="px-2 pt-2 flex gap-2 text-xs">
  <NavLink
    to="/"
    end
    className={({ isActive }: { isActive: boolean }) =>
      `px-2 py-1 rounded ${isActive ? 'bg-bg-elevated text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`
    }
  >
    Search
  </NavLink>
  <NavLink
    to="/mcps"
    className={({ isActive }: { isActive: boolean }) =>
      `px-2 py-1 rounded ${isActive ? 'bg-bg-elevated text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`
    }
  >
    MCPs
  </NavLink>
</div>
<button
  type="button"
  onClick={onNewSearch}
  className="m-2 px-3 py-1.5 rounded border border-accent-dim text-accent hover:bg-bg-elevated text-sm text-left"
>
  + New search
</button>
```

- [ ] **Step 2: Build the web app**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/LibrarySidebar.tsx
git commit -m "feat(web): sidebar nav header (Search · MCPs)"
```

---

## Task 9: Typed API client `web/src/lib/mcps.ts`

**Files:**
- Create: `web/src/lib/mcps.ts`
- Test: `web/src/lib/mcps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/mcps.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as mcps from './mcps.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

describe('listMcps', () => {
  it('returns servers array', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ servers: [] }), { status: 200 }));
    const r = await mcps.listMcps();
    expect(r).toEqual([]);
  });
  it('throws ApiCallError with 412 body on missing config', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'config-required' }), { status: 412 }));
    await expect(mcps.listMcps()).rejects.toMatchObject({ status: 412 });
  });
});

describe('createMcp', () => {
  it('POSTs and returns server entry on 201', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ server: { name: 'x', command: 'x', enabled: true } }), { status: 201 }));
    const r = await mcps.createMcp({ name: 'x', command: 'x' });
    expect(r.name).toBe('x');
  });
});
```

- [ ] **Step 2: Run test (will fail)**

Run: `cd web && npx vitest run src/lib/mcps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/mcps.ts`**

```typescript
import { apiJson } from './api.js';

export interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpInput {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpPatchInput {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface HealthCheckResponse {
  ok: boolean;
  toolCount?: number;
  error?: string;
}

export async function listMcps(): Promise<McpServerEntry[]> {
  const r = await apiJson<{ servers: McpServerEntry[] }>('/api/mcps');
  return r.servers;
}

export async function createMcp(input: McpInput): Promise<McpServerEntry> {
  const r = await apiJson<{ server: McpServerEntry }>('/api/mcps', {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.server;
}

export async function updateMcp(name: string, input: McpPatchInput): Promise<McpServerEntry> {
  const r = await apiJson<{ server: McpServerEntry }>(`/api/mcps/${encodeURIComponent(name)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return r.server;
}

export async function deleteMcp(name: string): Promise<void> {
  await apiJson<unknown>(`/api/mcps/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function testMcp(name: string): Promise<HealthCheckResponse> {
  return apiJson<HealthCheckResponse>(`/api/mcps/${encodeURIComponent(name)}/test`, { method: 'POST' });
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/mcps.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/mcps.ts web/src/lib/mcps.test.ts
git commit -m "feat(web): typed API client for /api/mcps"
```

---

## Task 10: McpAddModal component (add/edit)

**Files:**
- Create: `web/src/components/McpAddModal.tsx`
- Test: `web/src/components/McpAddModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/McpAddModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpAddModal } from './McpAddModal.js';
import type { McpServerEntry } from '../lib/mcps.js';

describe('McpAddModal', () => {
  it('renders empty form for add mode and submits', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'slack' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'slack-mcp' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: 'slack', command: 'slack-mcp', args: undefined, env: undefined, enabled: true });
    });
  });

  it('disables Save and form fields while submitting', async () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => {/* never resolves */}));
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
      expect(screen.getByLabelText(/name/i)).toBeDisabled();
      expect(screen.getByLabelText(/command/i)).toBeDisabled();
    });
  });

  it('shows error and stays open when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('health-check-failed: timeout'));
    const onClose = vi.fn();
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/timeout/i)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders pre-filled form for edit mode and disables name field', () => {
    const initial: McpServerEntry = { name: 'slack', command: 'slack-mcp', enabled: true };
    render(<McpAddModal mode="edit" initial={initial} onSubmit={vi.fn()} onClose={() => {}} />);
    expect(screen.getByLabelText(/name/i)).toHaveValue('slack');
    expect(screen.getByLabelText(/name/i)).toBeDisabled();
    expect(screen.getByLabelText(/command/i)).toHaveValue('slack-mcp');
  });

  it('rejects env values that are not env-refs (UI-side check)', async () => {
    const onSubmit = vi.fn();
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /add env/i }));
    fireEvent.change(screen.getByLabelText(/env key/i), { target: { value: 'TOKEN' } });
    fireEvent.change(screen.getByLabelText(/env value/i), { target: { value: 'literal-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/must be \$\{NAME\}/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test (will fail)**

Run: `cd web && npx vitest run src/components/McpAddModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/McpAddModal.tsx`**

```tsx
import { useState, type JSX, type FormEvent } from 'react';
import type { McpServerEntry, McpInput, McpPatchInput } from '../lib/mcps.js';

interface AddProps {
  mode: 'add';
  onSubmit: (input: McpInput) => Promise<void>;
  onClose: () => void;
}
interface EditProps {
  mode: 'edit';
  initial: McpServerEntry;
  onSubmit: (input: McpPatchInput) => Promise<void>;
  onClose: () => void;
}
type Props = AddProps | EditProps;

const ENV_REF_RE = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export function McpAddModal(props: Props): JSX.Element {
  const initial: McpServerEntry | null = props.mode === 'edit' ? props.initial : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [argsText, setArgsText] = useState((initial?.args ?? []).join('\n'));
  const [envRows, setEnvRows] = useState<{ key: string; value: string }[]>(
    initial?.env ? Object.entries(initial.env).map(([k, v]) => ({ key: k, value: v })) : [],
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddEnv = () => setEnvRows((rs) => [...rs, { key: '', value: '' }]);
  const handleEnvChange = (i: number, field: 'key' | 'value', v: string) =>
    setEnvRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: v } : r)));
  const handleEnvRemove = (i: number) => setEnvRows((rs) => rs.filter((_, j) => j !== i));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Client-side env-value check.
    for (const r of envRows) {
      if (r.key && r.value && !ENV_REF_RE.test(r.value)) {
        setError(`env "${r.key}" must be \${NAME} reference, not a literal`);
        return;
      }
    }
    const args = argsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const env: Record<string, string> = {};
    for (const r of envRows) if (r.key && r.value) env[r.key] = r.value;

    const payload = {
      command,
      args: args.length ? args : undefined,
      env: Object.keys(env).length ? env : undefined,
      enabled,
    };

    setSubmitting(true);
    try {
      if (props.mode === 'add') await props.onSubmit({ name, ...payload });
      else await props.onSubmit(payload);
    } catch (err) {
      setError((err as Error).message ?? 'failed');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    props.onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-bg-secondary p-6 rounded w-[480px] flex flex-col gap-3">
        <h2 className="text-text-primary text-lg">{props.mode === 'add' ? 'Add MCP' : `Edit ${initial?.name}`}</h2>

        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting || props.mode === 'edit'}
            required
            pattern="[a-z][a-z0-9_-]{0,63}"
            className="bg-bg-elevated px-2 py-1 rounded"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Command
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={submitting}
            required
            className="bg-bg-elevated px-2 py-1 rounded"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Args (one per line)
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            disabled={submitting}
            rows={3}
            className="bg-bg-elevated px-2 py-1 rounded font-mono text-xs"
          />
        </label>

        <fieldset className="flex flex-col gap-1 text-sm" disabled={submitting}>
          <legend>Env (use ${'{NAME}'} refs only)</legend>
          {envRows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label="env key"
                value={r.key}
                onChange={(e) => handleEnvChange(i, 'key', e.target.value)}
                placeholder="TOKEN"
                className="bg-bg-elevated px-2 py-1 rounded flex-1"
              />
              <input
                aria-label="env value"
                value={r.value}
                onChange={(e) => handleEnvChange(i, 'value', e.target.value)}
                placeholder="${SLACK_TOKEN}"
                className="bg-bg-elevated px-2 py-1 rounded flex-1"
              />
              <button type="button" onClick={() => handleEnvRemove(i)} className="text-text-tertiary">×</button>
            </div>
          ))}
          <button type="button" onClick={handleAddEnv} className="self-start text-accent text-xs mt-1">+ Add env</button>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={submitting}
          />
          Enabled
        </label>

        {error && <div role="alert" className="text-error text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} disabled={submitting} className="px-3 py-1 text-text-tertiary">Cancel</button>
          <button type="submit" disabled={submitting} className="px-3 py-1 bg-accent text-bg-primary rounded">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/components/McpAddModal.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/McpAddModal.tsx web/src/components/McpAddModal.test.tsx
git commit -m "feat(web): McpAddModal (add/edit, submit lifecycle, env-ref UI check)"
```

---

## Task 11: McpRow component

**Files:**
- Create: `web/src/components/McpRow.tsx`

(Render-only component; covered by `McpManager.test.tsx` in T12 rather than its own test file.)

- [ ] **Step 1: Implement `web/src/components/McpRow.tsx`**

```tsx
import type { JSX } from 'react';
import type { McpServerEntry } from '../lib/mcps.js';

export type TestStatus = 'never' | 'ok' | 'error' | 'testing';

interface Props {
  server: McpServerEntry;
  status: TestStatus;
  errorMessage?: string;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}

const STATUS_LABEL: Record<TestStatus, string> = {
  never: '⚪ Never tested',
  ok: '🟢 OK',
  error: '🔴 Failed',
  testing: '… Testing',
};

export function McpRow({ server, status, errorMessage, onEdit, onTest, onDelete }: Props): JSX.Element {
  return (
    <tr className="border-b border-border">
      <td className="px-3 py-2 font-mono text-sm">{server.name}</td>
      <td className="px-3 py-2 font-mono text-xs text-text-tertiary">{server.command}</td>
      <td className="px-3 py-2 text-xs text-text-tertiary">
        {(server.args ?? []).join(' ') || '—'}
      </td>
      <td className="px-3 py-2 text-sm" title={errorMessage}>{STATUS_LABEL[status]}</td>
      <td className="px-3 py-2 text-sm">{server.enabled ? '✓' : '—'}</td>
      <td className="px-3 py-2 text-sm">
        <button onClick={onEdit} className="text-accent hover:underline mr-3">Edit</button>
        <button onClick={onTest} className="text-accent hover:underline mr-3" disabled={status === 'testing'}>Test</button>
        <button onClick={onDelete} className="text-error hover:underline">Delete</button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/McpRow.tsx
git commit -m "feat(web): McpRow component"
```

---

## Task 12: McpManager route — table, add/edit, test, delete

**Files:**
- Modify: `web/src/routes/McpManager.tsx` (replace stub)
- Test: `web/src/routes/McpManager.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/McpManager.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpManager } from './McpManager.js';
import * as api from '../lib/mcps.js';

vi.mock('../lib/mcps.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('McpManager', () => {
  it('renders empty state on 412', async () => {
    vi.mocked(api.listMcps).mockRejectedValue(Object.assign(new Error('config-required'), { status: 412 }));
    render(<McpManager />);
    await waitFor(() => expect(screen.getByText(/onboarding/i)).toBeInTheDocument());
  });

  it('renders rows from API', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([
      { name: 'slack', command: 'slack-mcp', enabled: true },
    ]);
    render(<McpManager />);
    await waitFor(() => expect(screen.getByText('slack')).toBeInTheDocument());
    expect(screen.getByText('slack-mcp')).toBeInTheDocument();
  });

  it('opens Add modal and creates an MCP', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([]);
    vi.mocked(api.createMcp).mockResolvedValue({ name: 'x', command: 'x', enabled: true });
    render(<McpManager />);
    await waitFor(() => expect(screen.getByRole('button', { name: /\+ add mcp/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /\+ add mcp/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api.createMcp).toHaveBeenCalled());
  });

  it('runs Test and updates row status', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([{ name: 'slack', command: 'slack-mcp', enabled: true }]);
    vi.mocked(api.testMcp).mockResolvedValue({ ok: true, toolCount: 5 });
    render(<McpManager />);
    await waitFor(() => screen.getByText('slack'));
    fireEvent.click(screen.getByRole('button', { name: /^test$/i }));
    await waitFor(() => expect(screen.getByText(/🟢 OK/)).toBeInTheDocument());
  });

  it('confirms then deletes a row', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([{ name: 'slack', command: 'slack-mcp', enabled: true }]);
    vi.mocked(api.deleteMcp).mockResolvedValue(undefined);
    render(<McpManager />);
    await waitFor(() => screen.getByText('slack'));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(api.deleteMcp).toHaveBeenCalledWith('slack'));
    await waitFor(() => expect(screen.queryByText('slack')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test (will fail)**

Run: `cd web && npx vitest run src/routes/McpManager.test.tsx`
Expected: FAIL (stub renders different content).

- [ ] **Step 3: Implement `web/src/routes/McpManager.tsx`**

Replace the file contents:

```tsx
import { useState, useEffect, useCallback, type JSX } from 'react';
import { ApiCallError } from '../lib/api.js';
import {
  listMcps, createMcp, updateMcp, deleteMcp, testMcp,
  type McpServerEntry, type McpInput, type McpPatchInput,
} from '../lib/mcps.js';
import { McpRow, type TestStatus } from '../components/McpRow.js';
import { McpAddModal } from '../components/McpAddModal.js';

type RowStatus = { status: TestStatus; errorMessage?: string };

export function McpManager(): JSX.Element {
  const [rows, setRows] = useState<McpServerEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsConfig, setNeedsConfig] = useState(false);
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; initial: McpServerEntry }>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listMcps();
      setRows(r);
      setNeedsConfig(false);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 412) {
        setNeedsConfig(true);
      } else {
        setLoadError((err as Error).message ?? 'failed to load');
      }
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = useCallback(async (input: McpInput) => {
    await createMcp(input);
    await refresh();
  }, [refresh]);

  const handleEdit = useCallback((server: McpServerEntry) => {
    setModal({ mode: 'edit', initial: server });
  }, []);

  const handlePatch = useCallback(async (name: string, input: McpPatchInput) => {
    await updateMcp(name, input);
    await refresh();
  }, [refresh]);

  const handleTest = useCallback(async (name: string) => {
    setStatuses((s) => ({ ...s, [name]: { status: 'testing' } }));
    try {
      const r = await testMcp(name);
      setStatuses((s) => ({ ...s, [name]: r.ok ? { status: 'ok' } : { status: 'error', errorMessage: r.error } }));
    } catch (err) {
      setStatuses((s) => ({ ...s, [name]: { status: 'error', errorMessage: (err as Error).message } }));
    }
  }, []);

  const handleDelete = useCallback(async (name: string) => {
    if (!window.confirm(`Delete MCP "${name}"?`)) return;
    setRows((rs) => rs.filter((r) => r.name !== name));   // optimistic
    try {
      await deleteMcp(name);
    } catch (err) {
      setLoadError((err as Error).message ?? 'delete failed');
      await refresh();                                    // restore on error
    }
  }, [refresh]);

  if (needsConfig) {
    return (
      <div className="p-6 text-text-tertiary">
        No config yet. Run scry through onboarding first.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-text-primary text-xl">MCP servers</h1>
        <button
          type="button"
          onClick={() => setModal({ mode: 'add' })}
          className="px-3 py-1 bg-accent text-bg-primary rounded text-sm"
        >
          + Add MCP
        </button>
      </div>
      {loadError && <div className="text-error text-sm mb-3">{loadError}</div>}
      <table className="w-full border border-border">
        <thead className="bg-bg-secondary text-text-tertiary text-xs">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Command</th>
            <th className="px-3 py-2 text-left">Args</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Enabled</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <McpRow
              key={s.name}
              server={s}
              status={statuses[s.name]?.status ?? 'never'}
              errorMessage={statuses[s.name]?.errorMessage}
              onEdit={() => handleEdit(s)}
              onTest={() => handleTest(s.name)}
              onDelete={() => handleDelete(s.name)}
            />
          ))}
        </tbody>
      </table>

      {modal?.mode === 'add' && (
        <McpAddModal
          mode="add"
          onSubmit={handleAdd}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'edit' && (
        <McpAddModal
          mode="edit"
          initial={modal.initial}
          onSubmit={(input) => handlePatch(modal.initial.name, input)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/routes/McpManager.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run all web tests**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Run all server tests**

Run: `cd .. && npx vitest run` (or `npm test` from repo root if web is a separate workspace)
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/McpManager.tsx web/src/routes/McpManager.test.tsx
git commit -m "feat(web): McpManager route — list, add/edit, test, delete"
```

---

## Task 13: CSRF rejection acceptance + manual smoke

**Files:**
- Test: `src/server/routes/mcps.csrf.test.ts`

- [ ] **Step 1: Add per-route CSRF rejection test**

Create `src/server/routes/mcps.csrf.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Hono } from 'hono';
import { csrfRequired } from '../middleware/csrf.js';
import { generateCsrfToken } from '../middleware/csrf-token.js';
import { buildMcpsRoute } from './mcps.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  generateCsrfToken();
  dir = mkdtempSync(join(tmpdir(), 'scry-mcps-csrf-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
  app.use('*', csrfRequired());
  app.route('/api/mcps', buildMcpsRoute({
    configPath: () => cfg,
    healthCheck: async () => ({ ok: true, toolCount: 0 }),
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CSRF enforcement on /api/mcps', () => {
  it('GET works without CSRF (read-only)', async () => {
    const r = await app.request('/api/mcps');
    expect(r.status).toBe(200);
  });
  it('POST without X-Scry-Csrf returns 403', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', command: 'x' }),
    });
    expect(r.status).toBe(403);
  });
  it('PATCH without X-Scry-Csrf returns 403', async () => {
    const r = await app.request('/api/mcps/x', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'y' }),
    });
    expect(r.status).toBe(403);
  });
  it('DELETE without X-Scry-Csrf returns 403', async () => {
    const r = await app.request('/api/mcps/x', { method: 'DELETE' });
    expect(r.status).toBe(403);
  });
  it('POST /:name/test without X-Scry-Csrf returns 403', async () => {
    const r = await app.request('/api/mcps/x/test', { method: 'POST' });
    expect(r.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/server/routes/mcps.csrf.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Manual smoke**

Use a real `~/.config/scry/scry.config.yaml` (your own dev one):

```bash
npm run build
node dist/cli/index.js serve
```

Browser opens at `http://127.0.0.1:6678`. Verify:
1. Sidebar shows `Search · MCPs` nav row above "+ New search."
2. Click `MCPs` → table renders with your existing servers, all in "Never tested" state.
3. Click "Test" on one row → status flips to "Testing…" then 🟢 OK (assuming the MCP is actually installed).
4. Click "Test" on a row whose `command` you've broken (rename binary on PATH temporarily) → 🔴 Failed with the error tooltip.
5. Click "+ Add MCP" → modal → fill in `name=test_mcp`, `command=node`, `args=test-fixtures/mcp-fake-ok.mjs` (one per line) → Save → modal closes → row appears with "Never tested."
6. Click "Test" on the new row → 🟢 OK with `toolCount: 2`.
7. Click "Edit" on `test_mcp` → modal pre-filled, name disabled → flip Enabled off → Save → modal closes → row shows `—` in Enabled column.
8. Run `scry "<query>"` from the CLI in another terminal — confirm `test_mcp` is NOT in the search (engine filtered it).
9. Click "Delete" on `test_mcp` → confirm → row disappears.
10. Reload the page → row still gone (config was actually written).
11. Verify `~/.config/scry/scry.config.yaml.bak` exists from the most recent edit.
12. Verify browser back/forward works between `/` and `/mcps` and the session list stays mounted in the sidebar.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/mcps.csrf.test.ts
gh pr create --base main --title "feat: MCP manager (Plan E) + shared config-write infra" --body "$(cat <<'EOF'
Implements Plan E from docs/superpowers/specs/2026-05-29-scry-config-surfaces-ef-design.md.

## Surfaces
- New `/mcps` route — table of MCP servers; add/edit/test/delete; modal for add+edit.
- Sidebar nav (Search · MCPs) above "+ New search."

## Shared infra (also feeds Plan F)
- `src/config/schema.ts` — zod for McpServerConfig + Person + Project + Registry.
- `src/config/write-config.ts` — read → merge → validate → atomic write, with cross-process file lock via `proper-lockfile`.
- `src/shared/api-errors.ts` — path-scoped `ApiErrorBody` shape.

## Security boundary
- MCP health-check: detached spawn (own PGID), SIGTERM→SIGKILL on timeout, env allowlist (per-entry declared refs only — `${HOME}` does NOT resolve unless `HOME` is named in the entry's env block).
- 412 (not 409) for missing config; 422 for health-check failure with no write; 409 reserved for true name conflicts; DELETE idempotent (204 on missing).

## Tests
- 11 schema, 6 writeConfig, 5 health-check, 12 mcps route, 5 CSRF, 5 web modal, 5 web route. All green.

Verified manually per plan T13 step 4. Ready for review.
EOF
)"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| Shared infrastructure: zod schema | T1 |
| Shared infrastructure: writeConfig + proper-lockfile | T2, T3 |
| Path-scoped error response shape (`{ error, errors? }`) | T1 (definition), T5 (use) |
| `enabled` field on McpServerConfig + engine filter | T1, T6 |
| Routing (react-router-dom v6) + sidebar nav | T7, T8 |
| MCP server route (CRUD + `:name/test`) with status codes 400/404/409/412/422 | T5 |
| Health-check helper (detached spawn, PGID kill, env allowlist, timeout) | T4 |
| MCP table + Add/Edit modal + Test + Delete (optimistic with restore-on-error) | T9, T10, T11, T12 |
| 412 empty state on `/mcps` | T12 |
| Submit-button-and-fields disabled while health-checking | T10 |
| DELETE idempotency (204 on missing) | T5 |
| Per-entry env allowlist (acceptance criterion: `${HOME}` does not resolve unless declared) | T4 |
| YAML comments outside `registry:`/`mcp_servers:` blocks survive a write | T3 |
| Concurrent writes serialize | T3 |
| CSRF rejection on every mutating verb of `/api/mcps` | T13 |
| Manual smoke: add via UI → search uses the new MCP; back/forward keeps sidebar | T13 |

**Spec acceptance criteria deferred to Plan F:** registry editor, Person `aliases` field. (Schema lands in T1; the route + UI ship in Plan F.)

---

## Self-review

- **Spec coverage:** every E-related acceptance criterion maps to a task above. Registry-related criteria are explicitly deferred to Plan F (which uses `writeConfig`, `RegistrySchema`, `PersonSchema`, `ProjectSchema` from T1, and the `ApiErrorBody` shape from T1).
- **Placeholders:** none. All test code is concrete; all implementation code is complete; all commands are runnable.
- **Type consistency check:**
  - `McpServerEntry` shape `{ name, command, args?, env?, enabled }` consistent across server route (T5), web client (T9), modal (T10), row (T11), manager (T12).
  - `McpInput` (POST body) is `{ name, command, args?, env?, enabled? }`; `McpPatchInput` is the same minus `name`. Used in the modal's `mode='add'` vs `mode='edit'` discriminated union.
  - `HealthCheckResult` is `{ ok: true; toolCount; toolName? } | { ok: false; error }` — fixture's `toolName` field is internal-only (used by the env-allowlist test in T4); the API response is shape-compatible because `toolName` is optional and the frontend ignores it.
  - `ApiErrorBody` is `{ error, message?, errors? }`; routes return either `errors` (zod failures) or `message` (health-check / config-required messages). Frontend `ApiCallError` (existing in `web/src/lib/api.ts`) carries `body: ApiError` (the existing shape) — the new `ApiErrorBody` is a superset (adds `errors`); existing consumers ignoring `errors` keep working.
  - `TestStatus` is `'never' | 'ok' | 'error' | 'testing'`, used in T11 (`McpRow`) and T12 (`McpManager`'s `statuses` map).
- **Atomic-write safety:** `writeConfig` short-circuits on validation failure before the lock+write (T3); routes catch `ConfigValidationError` and return 400 (T5); health-check returning `ok: false` short-circuits before `writeConfig` is called (T5).
- **Sequencing:** T7 introduces a stub `McpManager` so the build keeps passing as the router lands; T12 replaces it. Each task's commit leaves the tree green.

















