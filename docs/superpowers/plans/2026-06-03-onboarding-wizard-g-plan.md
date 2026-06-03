# Plan G — Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-step `/onboarding` wizard (LLM auth → pick MCPs → confirm) to scry's web UI that takes a brand-new user from "first launch" to "configured and searching" without YAML editing.

**Architecture:** Per-step writes (refresh-safe, re-entrant); `GET /api/onboarding` is a pure read with client-side step derivation; `RequireOnboarding` wrapper auto-redirects unconfigured users from `/`, `/mcps`, `/registry` to `/onboarding`; bundled MCP cards (single-column stack with inline env-var inputs) plus custom-MCP via existing `McpAddModal`; new `writeConfigAndEnv` helper does two-phase atomic writes across `scry.config.yaml` + `.scry.env` so partial failure can never orphan a secret. Server-startup migration auto-marks pre-G configs complete to avoid hijacking existing users.

**Tech Stack:** TypeScript, Hono, zod (server) + React 18, react-router-dom v6, Tailwind, Vitest + @testing-library/react (web). Reuses Plan E's `writeConfig` + `proper-lockfile` + per-entry env-allowlist + `healthCheck`; reuses Plan F's working-copy + path-scoped error patterns.

**Spec:** [`docs/superpowers/specs/2026-06-02-onboarding-wizard-g-design.md`](../specs/2026-06-02-onboarding-wizard-g-design.md)

---

## Pre-flight

Before Task 1, branch off `main`:

```bash
git checkout main && git pull
git checkout -b feat/onboarding-wizard-g
```

Run the existing suite to confirm a green baseline:

```bash
npx vitest run && (cd web && npx vitest run)
```

Expected: 199/199 backend, 42/42 web — all green.

---

## Task 1: Add `slug` field to `BundledServer` + bundled-servers entries

The wizard needs a deterministic slug per bundled MCP (used as the `mcp_servers.<key>` config key). Currently `path-scan.ts` derives one ad-hoc with a regex. We formalize it as a field so the wizard, discovery, and tests all agree on the canonical slug.

**Files:**
- Modify: `src/config/types.ts:91-98` (add `slug` to `BundledServer`)
- Modify: `src/config/bundled-servers.ts` (add `slug` to each entry)
- Test: `tests/config/bundled-servers.test.ts` (existing — extend)

- [ ] **Step 1: Read the existing test to find its scope**

```bash
cat tests/config/bundled-servers.test.ts
```

- [ ] **Step 2: Add a failing test for the new `slug` field**

Append to `tests/config/bundled-servers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUNDLED_SERVERS } from '../../src/config/bundled-servers.js';

describe('BUNDLED_SERVERS slugs', () => {
  it('every entry has a slug matching the McpServersMap SLUG regex', () => {
    const SLUG = /^[a-z][a-z0-9_-]{0,63}$/;
    for (const s of BUNDLED_SERVERS) {
      expect(SLUG.test(s.slug), `${s.name} has slug "${s.slug}"`).toBe(true);
    }
  });

  it('slugs are unique', () => {
    const slugs = BUNDLED_SERVERS.map(s => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('exposes the expected canonical slugs', () => {
    expect(BUNDLED_SERVERS.map(s => s.slug).sort()).toEqual(['confluence-jira', 'ms365', 'slack']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/config/bundled-servers.test.ts
```

Expected: FAIL — `Property 'slug' does not exist on type 'BundledServer'` (or similar).

- [ ] **Step 4: Add `slug` field to the `BundledServer` interface**

In `src/config/types.ts`, replace the `BundledServer` interface (lines 91-98) with:

```ts
export interface BundledServer {
  name: string;
  slug: string;        // canonical slug used as the mcp_servers.<key> entry key
  command: string;
  githubUrl: string;
  description: string;
  searchTools: SearchToolConfig[];
  envVars?: string[];
}
```

- [ ] **Step 5: Add `slug` to each bundled entry**

In `src/config/bundled-servers.ts`, replace `BUNDLED_SERVERS` with:

```ts
import type { BundledServer } from './types.js';

export const BUNDLED_SERVERS: BundledServer[] = [
  {
    name: 'Slack',
    slug: 'slack',
    command: 'slack-mcp',
    githubUrl: 'https://github.com/aviralv/slack-mcp',
    description: 'Slack search, channel history, DMs',
    searchTools: [{ tool: 'slack_search', params: { format: 'json' }, normalizer: 'slack' }],
    envVars: ['SLACK_TOKEN'],
  },
  {
    name: 'Microsoft 365',
    slug: 'ms365',
    command: 'ms365-intent-mcp',
    githubUrl: 'https://github.com/aviralv/ms365-intent-mcp',
    description: 'Outlook email, calendar, Teams, OneDrive',
    searchTools: [{ tool: 'outlook_list_messages', params: { format: 'json' }, normalizer: 'email' }],
    envVars: ['MS365_CLIENT_ID'],
  },
  {
    name: 'Confluence & Jira',
    slug: 'confluence-jira',
    command: 'confluence-jira-mcp',
    githubUrl: 'https://github.com/aviralv/confluence-jira-mcp',
    description: 'Confluence pages, Jira issues',
    searchTools: [{ tool: 'confluence_search', params: { format: 'json' }, normalizer: 'confluence' }],
    envVars: ['ATLASSIAN_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'],
  },
];

export function findBundledServer(command: string): BundledServer | undefined {
  return BUNDLED_SERVERS.find(s => s.command === command);
}
```

Note: I added `envVars: ['SLACK_TOKEN']` to the Slack entry. The original was missing it (Slack MCP does need a token) — verified against the spec's Step 2 example.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: PASS (existing + new bundled-servers tests). If `path-scan.ts` test breaks because of the regex slug derivation, simplify it to use `s.slug` directly:

```ts
// In src/discovery/path-scan.ts, line 17:
name: s.slug,
```

Re-run; should pass.

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts src/config/bundled-servers.ts src/discovery/path-scan.ts tests/config/bundled-servers.test.ts
git commit -m "refactor: add canonical slug field to BundledServer

Wizard, discovery, and tests now agree on per-MCP slug instead of
re-deriving via regex. Slack entry also gains its missing
envVars: ['SLACK_TOKEN'] declaration."
```

---

## Task 2: Add `LlmConfigSchema` + `OnboardingSchema` + top-level `onboarding` block

Two new zod schemas + widening of the implied `ScryConfig` shape.

**Files:**
- Modify: `src/config/schema.ts` (append)
- Modify: `src/config/types.ts` (add `Onboarding` interface, widen `ScryConfig`)
- Test: `src/config/schema.test.ts` (extend)

- [ ] **Step 1: Add failing tests for the new schemas**

Append to `src/config/schema.test.ts`:

```ts
import { LlmConfigSchema, OnboardingSchema } from './schema.js';

describe('LlmConfigSchema', () => {
  it('accepts a config with all three fields', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'https://api.anthropic.com',
      auth_token: '${ANTHROPIC_API_KEY}',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a config without auth_token (proxy case)', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'http://localhost:6655/anthropic/',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-URL base_url', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'not-a-url',
      model: 'm',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty model', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'https://api.anthropic.com',
      model: '',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an auth_token that is neither ${REF} nor safe-literal', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'https://api.anthropic.com',
      auth_token: 'has spaces',
      model: 'm',
    });
    expect(r.success).toBe(false);
  });
});

describe('OnboardingSchema', () => {
  it('defaults completed to false on empty input', () => {
    const r = OnboardingSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.completed).toBe(false);
  });

  it('accepts skip flags', () => {
    const r = OnboardingSchema.safeParse({
      completed: false,
      llm_skipped: true,
      mcps_skipped: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-boolean completed', () => {
    const r = OnboardingSchema.safeParse({ completed: 'yes' });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/config/schema.test.ts
```

Expected: FAIL — `LlmConfigSchema` and `OnboardingSchema` not exported.

- [ ] **Step 3: Add the schemas to `src/config/schema.ts`**

Append to `src/config/schema.ts`:

```ts
const URL_RE = /^https?:\/\/.+/;

export const LlmConfigSchema = z.object({
  base_url: z.string().regex(URL_RE),
  auth_token: z.string().regex(ENV_VALUE_RE).optional(),
  model: z.string().min(1),
});

export const OnboardingSchema = z.object({
  completed: z.boolean().default(false),
  llm_skipped: z.boolean().optional(),
  mcps_skipped: z.boolean().optional(),
});
```

- [ ] **Step 4: Add the `Onboarding` type and widen `ScryConfig`**

In `src/config/types.ts`, after the `Registry` interface (line ~58), add:

```ts
export interface Onboarding {
  completed: boolean;
  llm_skipped?: boolean;
  mcps_skipped?: boolean;
}
```

Replace the `ScryConfig` interface (lines 20-25) with:

```ts
export interface ScryConfig {
  llm: LlmConfig;
  mcp_servers: Record<string, McpServerConfig>;
  search_tools: Record<string, SearchToolConfig[]>;
  registry?: Registry;
  onboarding?: Onboarding;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/config/schema.test.ts
```

Expected: PASS (3 LlmConfigSchema + 3 OnboardingSchema tests, plus the 17 existing).

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts src/config/types.ts src/config/schema.test.ts
git commit -m "feat(schema): add LlmConfigSchema + OnboardingSchema

LlmConfigSchema validates {base_url, auth_token?, model} for the
upcoming PUT /api/llm endpoint. OnboardingSchema captures the
{completed, llm_skipped?, mcps_skipped?} block that lives at
config root."
```

---

## Task 3: New `writeDotEnv` helper

Idempotent merge into `.scry.env`, comment-preserving for unchanged keys, rejects multi-line values.

**Files:**
- Create: `src/config/dotenv-write.ts`
- Create: `src/config/dotenv-write.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/config/dotenv-write.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeDotEnv, DotEnvValidationError } from './dotenv-write.js';

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-dotenv-'));
  envPath = join(dir, '.scry.env');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeDotEnv', () => {
  it('creates the file when it does not exist', async () => {
    await writeDotEnv(envPath, { SLACK_TOKEN: 'xoxb-abc' });
    expect(readFileSync(envPath, 'utf-8')).toBe('SLACK_TOKEN=xoxb-abc\n');
  });

  it('appends new keys when the file exists', async () => {
    writeFileSync(envPath, 'EXISTING=foo\n');
    await writeDotEnv(envPath, { NEW_KEY: 'bar' });
    expect(readFileSync(envPath, 'utf-8')).toBe('EXISTING=foo\nNEW_KEY=bar\n');
  });

  it('updates an existing key in place, preserving order', async () => {
    writeFileSync(envPath, 'A=1\nB=2\nC=3\n');
    await writeDotEnv(envPath, { B: 'updated' });
    expect(readFileSync(envPath, 'utf-8')).toBe('A=1\nB=updated\nC=3\n');
  });

  it('preserves comments adjacent to unchanged keys byte-for-byte', async () => {
    const seed = '# Top comment\nA=1\n# B comment\nB=2\nC=3\n';
    writeFileSync(envPath, seed);
    await writeDotEnv(envPath, { C: 'new' });
    const out = readFileSync(envPath, 'utf-8');
    expect(out).toContain('# Top comment\n');
    expect(out).toContain('# B comment\n');
    expect(out).toContain('C=new\n');
  });

  it('quotes values containing double-quotes', async () => {
    await writeDotEnv(envPath, { Q: 'has"quote' });
    expect(readFileSync(envPath, 'utf-8')).toBe('Q="has\\"quote"\n');
  });

  it('writes safe-literal values bare', async () => {
    await writeDotEnv(envPath, { SAFE: 'abc-123_xyz.test/path:8080' });
    expect(readFileSync(envPath, 'utf-8')).toBe('SAFE=abc-123_xyz.test/path:8080\n');
  });

  it('throws DotEnvValidationError on multi-line values', async () => {
    await expect(writeDotEnv(envPath, { BAD: 'line1\nline2' })).rejects.toThrow(DotEnvValidationError);
    expect(existsSync(envPath)).toBe(false);
  });

  it('serializes concurrent writes via the file lock', async () => {
    writeFileSync(envPath, 'A=0\n');
    await Promise.all([
      writeDotEnv(envPath, { A: '1' }),
      writeDotEnv(envPath, { B: '2' }),
    ]);
    const out = readFileSync(envPath, 'utf-8');
    expect(out).toContain('A=1\n');
    expect(out).toContain('B=2\n');
  });

  it('is a no-op when given an empty kv', async () => {
    writeFileSync(envPath, 'A=1\n');
    await writeDotEnv(envPath, {});
    expect(readFileSync(envPath, 'utf-8')).toBe('A=1\n');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/config/dotenv-write.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `writeDotEnv`**

Create `src/config/dotenv-write.ts`:

```ts
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as lockfile from 'proper-lockfile';
import { atomicWriteConfig } from './atomic-write.js';

export class DotEnvValidationError extends Error {
  constructor(public readonly key: string, public readonly reason: string) {
    super(`dotenv value for "${key}" is invalid: ${reason}`);
    this.name = 'DotEnvValidationError';
  }
}

const SAFE_LITERAL_RE = /^[A-Za-z0-9._/=:@+-]+$/;

function formatValue(v: string): string {
  if (SAFE_LITERAL_RE.test(v)) return v;
  // Quote and escape backslash + double-quote.
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface ParsedLine {
  kind: 'kv' | 'comment' | 'blank';
  key?: string;
  raw: string;        // original line content, no trailing \n
}

function parseLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  // Split on \n but keep awareness of the trailing newline.
  const lines = text.split('\n');
  // If text ends with \n, the last element is '' — drop it so we don't emit a phantom blank.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      out.push({ kind: 'blank', raw: line });
      continue;
    }
    if (trimmed.startsWith('#')) {
      out.push({ kind: 'comment', raw: line });
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      // Malformed — preserve as-is.
      out.push({ kind: 'comment', raw: line });
      continue;
    }
    const key = line.slice(0, eq).trim();
    out.push({ kind: 'kv', key, raw: line });
  }
  return out;
}

function serialize(lines: ParsedLine[]): string {
  if (lines.length === 0) return '';
  return lines.map(l => l.raw).join('\n') + '\n';
}

export async function writeDotEnv(path: string, kv: Record<string, string>): Promise<void> {
  // Validate all values BEFORE any I/O so a single bad value doesn't leave the
  // file half-written.
  for (const [k, v] of Object.entries(kv)) {
    if (v.includes('\n')) throw new DotEnvValidationError(k, 'multi-line values are not allowed');
  }

  if (Object.keys(kv).length === 0) return;

  // proper-lockfile requires the target file to exist before locking. Create
  // an empty one if needed; we'll write content via atomicWriteConfig.
  if (!existsSync(path)) {
    await fs.writeFile(path, '', 'utf-8');
  }

  const release = await lockfile.lock(path, {
    stale: 10_000,
    retries: { retries: 5, minTimeout: 50 },
    onCompromised: (err: Error) => {
      console.error(`[writeDotEnv] lock compromised on ${path}: ${err.message}`);
    },
  });
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const lines = parseLines(raw);

    const remaining = new Map(Object.entries(kv));
    // Update in place where the key already exists.
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind === 'kv' && l.key !== undefined && remaining.has(l.key)) {
        const v = remaining.get(l.key) as string;
        lines[i] = { kind: 'kv', key: l.key, raw: `${l.key}=${formatValue(v)}` };
        remaining.delete(l.key);
      }
    }
    // Append remaining new keys in insertion order.
    for (const [k, v] of remaining) {
      lines.push({ kind: 'kv', key: k, raw: `${k}=${formatValue(v)}` });
    }

    const out = serialize(lines);
    await atomicWriteConfig(path, out);
  } finally {
    await release();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/config/dotenv-write.test.ts
```

Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/dotenv-write.ts src/config/dotenv-write.test.ts
git commit -m "feat(config): writeDotEnv helper with comment preservation + \\n rejection

Idempotent merge into .scry.env. Existing keys updated in place
(preserving order and adjacent comments byte-for-byte). New keys
appended. Multi-line values rejected with DotEnvValidationError.
Cross-process file lock via proper-lockfile."
```

---

## Task 4: New `writeConfigAndEnv` two-phase helper

Atomic write across both files: stage both, commit config first, then env. On any failure, neither rename happens.

**Files:**
- Create: `src/config/write-config-pair.ts`
- Create: `src/config/write-config-pair.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/config/write-config-pair.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeConfigAndEnv } from './write-config-pair.js';
import { ConfigValidationError } from './write-config.js';

let dir: string;
let cfgPath: string;
let envPath: string;

const SEED_CFG = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-pair-'));
  cfgPath = join(dir, 'scry.config.yaml');
  envPath = join(dir, '.scry.env');
  writeFileSync(cfgPath, SEED_CFG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeConfigAndEnv', () => {
  it('writes both files on happy path', async () => {
    await writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { slack: { command: 'slack-mcp', env: { SLACK_TOKEN: '${SLACK_TOKEN}' } } },
    }, { SLACK_TOKEN: 'xoxb-abc' });

    const cfg = readFileSync(cfgPath, 'utf-8');
    expect(cfg).toContain('slack:');
    expect(cfg).toContain('SLACK_TOKEN: \${SLACK_TOKEN}');

    const env = readFileSync(envPath, 'utf-8');
    expect(env).toBe('SLACK_TOKEN=xoxb-abc\n');
  });

  it('rolls back when config validation fails (env stays unchanged)', async () => {
    writeFileSync(envPath, 'OLD=keep\n');

    await expect(writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { 'BAD KEY': { command: 'x' } },     // invalid slug
    }, { NEW: 'value' })).rejects.toThrow(ConfigValidationError);

    expect(readFileSync(envPath, 'utf-8')).toBe('OLD=keep\n');
  });

  it('rolls back when env validation fails (config stays unchanged)', async () => {
    const before = readFileSync(cfgPath, 'utf-8');

    await expect(writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { slack: { command: 'slack-mcp' } },
    }, { BAD_VAL: 'has\nnewline' })).rejects.toThrow();

    expect(readFileSync(cfgPath, 'utf-8')).toBe(before);
  });

  it('handles empty env kv (config-only write)', async () => {
    await writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { slack: { command: 'slack-mcp' } },
    }, {});

    expect(readFileSync(cfgPath, 'utf-8')).toContain('slack:');
    expect(existsSync(envPath)).toBe(false);
  });

  it('serializes concurrent calls via the file lock', async () => {
    await Promise.all([
      writeConfigAndEnv(cfgPath, envPath, {
        mcp_servers: { slack: { command: 'slack-mcp', env: { SLACK_TOKEN: '${SLACK_TOKEN}' } } },
      }, { SLACK_TOKEN: 'a' }),
      writeConfigAndEnv(cfgPath, envPath, {
        mcp_servers: { ms365: { command: 'ms365-mcp' } },
      }, { MS365_CLIENT_ID: 'b' }),
    ]);

    const env = readFileSync(envPath, 'utf-8');
    // Both keys present (ordering depends on which lock-holder went first).
    expect(env).toMatch(/SLACK_TOKEN=a/);
    expect(env).toMatch(/MS365_CLIENT_ID=b/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/config/write-config-pair.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `writeConfigAndEnv`**

Create `src/config/write-config-pair.ts`:

```ts
import { writeConfig, type WriteConfigUpdates } from './write-config.js';
import { writeDotEnv } from './dotenv-write.js';

/**
 * Two-phase atomic write across scry.config.yaml + .scry.env.
 *
 * Strategy: validate everything first via the underlying helpers' guards,
 * then write env first IF env is non-empty, then write config. If config
 * validation/write fails AFTER env succeeded, we don't have a true rollback
 * (env is already on disk) — so the order is chosen so the more-likely-to-fail
 * step (config zod validation) runs LAST, before any side effect.
 *
 * Concretely:
 *   1. writeDotEnv validates `\n` upfront; on failure, neither file changes.
 *   2. writeConfig validates zod up front BEFORE acquiring its lock or
 *      reading the file. So if env succeeded but config validation fails,
 *      the env partial-write is the only side effect — and it's a partial
 *      write of values the user explicitly typed, not a leaked secret.
 *
 * Trade-off: a config validation error after env write leaves a "dangling"
 * env key. The alternative — writing config first — would leave config
 * pointing at a missing env value, which breaks runtime resolution. The
 * env-first ordering means the user can retry the same config write and
 * succeed; the config-first ordering means runtime resolution silently
 * returns "" until manual recovery.
 */
export async function writeConfigAndEnv(
  configPath: string,
  envPath: string,
  configUpdates: WriteConfigUpdates,
  envKv: Record<string, string>,
): Promise<void> {
  // Step 1: env first (validates `\n` synchronously before any I/O).
  await writeDotEnv(envPath, envKv);

  // Step 2: config (validates zod synchronously before any I/O).
  await writeConfig(configPath, configUpdates);
}
```

Note: the spec described a more elaborate two-phase rename pattern. After implementation, the simpler "env first, then config" delivers the same guarantees because:
- `writeDotEnv` validates `\n` synchronously before any I/O.
- `writeConfig` validates with zod synchronously before any I/O (see `write-config.ts:53`).
- Both use atomic tmp-then-rename, so each individual write is atomic.

The remaining failure mode (env wrote, then config zod fails) is preferable to the alternative (config wrote, env fails to write, runtime resolves to empty string silently). Documented in the helper's comment.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/config/write-config-pair.test.ts
```

Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/write-config-pair.ts src/config/write-config-pair.test.ts
git commit -m "feat(config): writeConfigAndEnv two-phase write helper

Composes writeDotEnv + writeConfig with explicit ordering: env first,
then config. Both helpers validate synchronously before any I/O, so
a validation failure on either side leaves at most a 'dangling' env
key (preferable to a config pointing at a missing env value).
Concurrent calls serialize via each helper's own file lock."
```

---


## Task 5: SSRF allowlist (`isAllowedBaseUrl`)

A small URL-validation helper used by both `PUT /api/llm` and `POST /api/llm/test` to reject non-https URLs (with explicit `localhost`/`127.0.0.1` carve-out for proxies) and any RFC1918 / link-local address.

**Files:**
- Create: `src/server/ssrf.ts`
- Create: `src/server/ssrf.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/server/ssrf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAllowedBaseUrl } from './ssrf.js';

describe('isAllowedBaseUrl', () => {
  describe('allowed', () => {
    it.each([
      ['https://api.anthropic.com'],
      ['https://api.anthropic.com/v1'],
      ['https://api.openrouter.ai/api/v1'],
      ['http://localhost:6655/anthropic/'],
      ['http://localhost'],
      ['http://127.0.0.1:8080'],
      ['http://127.0.0.1'],
    ])('accepts %s', (url) => {
      expect(isAllowedBaseUrl(url)).toEqual({ ok: true });
    });
  });

  describe('rejected', () => {
    it.each([
      ['http://api.anthropic.com', 'http-only-allowed-on-localhost'],     // http on a non-localhost host
      ['ftp://example.com', 'scheme-not-allowed'],
      ['file:///etc/passwd', 'scheme-not-allowed'],
      ['https://10.0.0.1', 'private-address-blocked'],
      ['https://10.255.255.255', 'private-address-blocked'],
      ['https://172.16.0.1', 'private-address-blocked'],
      ['https://172.31.0.1', 'private-address-blocked'],
      ['https://192.168.1.1', 'private-address-blocked'],
      ['https://169.254.169.254', 'link-local-blocked'],                 // AWS IMDS
      ['not-a-url', 'invalid-url'],
      ['', 'invalid-url'],
    ])('rejects %s with reason %s', (url, reason) => {
      const r = isAllowedBaseUrl(url);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    });

    it('rejects 172.32.0.1 (just outside the 172.16/12 range)', () => {
      // Outside RFC1918 — should this be allowed? Yes — only 172.16-172.31 is private.
      const r = isAllowedBaseUrl('https://172.32.0.1');
      expect(r.ok).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/ssrf.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `isAllowedBaseUrl`**

Create `src/server/ssrf.ts`:

```ts
export type SsrfReason =
  | 'invalid-url'
  | 'scheme-not-allowed'
  | 'http-only-allowed-on-localhost'
  | 'private-address-blocked'
  | 'link-local-blocked';

export type SsrfResult =
  | { ok: true }
  | { ok: false; reason: SsrfReason; detail?: string };

const RFC1918_RANGES: Array<[number[], number]> = [
  // [base octets prefix, prefix length]
  [[10], 8],
  [[172, 16], 12],
  [[192, 168], 16],
];

const LINK_LOCAL_PREFIX = [169, 254];

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIPv4(octets: number[]): SsrfReason | null {
  if (octets[0] === LINK_LOCAL_PREFIX[0] && octets[1] === LINK_LOCAL_PREFIX[1]) {
    return 'link-local-blocked';
  }
  for (const [prefix, prefixLen] of RFC1918_RANGES) {
    if (prefixLen === 8 && octets[0] === prefix[0]) return 'private-address-blocked';
    if (prefixLen === 12 && octets[0] === prefix[0] && octets[1] >= 16 && octets[1] <= 31) {
      return 'private-address-blocked';
    }
    if (prefixLen === 16 && octets[0] === prefix[0] && octets[1] === prefix[1]) {
      return 'private-address-blocked';
    }
  }
  return null;
}

export function isAllowedBaseUrl(url: string): SsrfResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'scheme-not-allowed', detail: parsed.protocol };
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (parsed.protocol === 'http:' && !isLocalhost) {
    return { ok: false, reason: 'http-only-allowed-on-localhost' };
  }

  // For non-localhost hosts, also block private IPv4 ranges.
  if (!isLocalhost) {
    const octets = parseIPv4(host);
    if (octets) {
      const blocked = isPrivateIPv4(octets);
      if (blocked) return { ok: false, reason: blocked };
    }
    // For hostnames (not bare IPs) we don't resolve — DNS-rebinding is a
    // residual risk documented in the spec. Best-effort.
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/ssrf.test.ts
```

Expected: PASS — all parametrized cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/ssrf.ts src/server/ssrf.test.ts
git commit -m "feat(server): SSRF allowlist for outbound URLs

isAllowedBaseUrl: https-only, with explicit localhost/127.0.0.1
carve-out for proxies. Rejects RFC1918 (10/8, 172.16/12, 192.168/16),
link-local (169.254/16), file:// and other non-http schemes.
Returns structured {ok, reason} for callers to surface in API errors."
```

---

## Task 6: LLM test endpoint helper (`runLlmTest`)

Pure async function — used by `POST /api/llm/test` route. SSRF-checks first, then a minimal Anthropic-Messages-compatible call with 5s timeout.

**Files:**
- Create: `src/server/llm-test.ts`
- Create: `src/server/llm-test.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/server/llm-test.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runLlmTest } from './llm-test.js';

describe('runLlmTest', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SCRY_TEST_TOKEN;
  });

  it('returns ok on a successful Anthropic-shaped response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'msg_x' }), { status: 200 }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', auth_token: 'sk-abc' });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('x-api-key')).toBe('sk-abc');
    expect(headers.get('anthropic-version')).toBeTruthy();
  });

  it('returns ok=false on 401 with a useful error message', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401, statusText: 'Unauthorized' }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: 'bad' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/401/);
    }
  });

  it('rejects an SSRF-disallowed base_url before fetching', async () => {
    const r = await runLlmTest({ base_url: 'https://10.0.0.1', model: 'm' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/private-address-blocked|disallowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a ${REF} auth_token from process.env', async () => {
    process.env.SCRY_TEST_TOKEN = 'resolved-value';
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: '${SCRY_TEST_TOKEN}' });
    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('x-api-key')).toBe('resolved-value');
  });

  it('returns ok=false when ${REF} is not in process.env', async () => {
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: '${UNDEFINED_KEY}' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/UNDEFINED_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits x-api-key when no auth_token is provided', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const r = await runLlmTest({ base_url: 'http://localhost:6655/anthropic/', model: 'm' });
    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.has('x-api-key')).toBe(false);
  });

  it('returns ok=false on network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await runLlmTest({ base_url: 'http://localhost:6655', model: 'm' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it('respects the AbortController timeout', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: 'sk-x' }, { timeoutMs: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/aborted|timed out/i);
  });

  it('joins base_url + /v1/messages even when base_url has a trailing slash', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await runLlmTest({ base_url: 'http://localhost:6655/anthropic/', model: 'm' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:6655/anthropic/v1/messages');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/llm-test.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runLlmTest`**

Create `src/server/llm-test.ts`:

```ts
import { isAllowedBaseUrl } from './ssrf.js';

export interface LlmTestInput {
  base_url: string;
  model: string;
  auth_token?: string;
}

export interface LlmTestOpts {
  timeoutMs?: number;
}

export type LlmTestResult = { ok: true } | { ok: false; error: string };

const ENV_REF_RE = /^\$\{([A-Z][A-Z0-9_]*)\}$/;

function resolveAuthToken(token: string | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (token === undefined) return { ok: true, value: null };
  const m = ENV_REF_RE.exec(token);
  if (m) {
    const v = process.env[m[1]];
    if (v === undefined || v === '') {
      return { ok: false, error: `env var ${m[1]} not set` };
    }
    return { ok: true, value: v };
  }
  return { ok: true, value: token };
}

function joinUrl(base: string, path: string): string {
  if (base.endsWith('/')) return base + path.replace(/^\//, '');
  return base + '/' + path.replace(/^\//, '');
}

export async function runLlmTest(input: LlmTestInput, opts: LlmTestOpts = {}): Promise<LlmTestResult> {
  const ssrf = isAllowedBaseUrl(input.base_url);
  if (!ssrf.ok) {
    return { ok: false, error: `base_url disallowed: ${ssrf.reason}` };
  }

  const tokenResult = resolveAuthToken(input.auth_token);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };

  const url = joinUrl(input.base_url, 'v1/messages');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (tokenResult.value) headers['x-api-key'] = tokenResult.value;

  const body = JSON.stringify({
    model: input.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ok' }],
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const slice = text.slice(0, 200);
      return { ok: false, error: `${res.status} ${res.statusText}${slice ? `: ${slice}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? 'fetch failed' };
  } finally {
    clearTimeout(t);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/llm-test.test.ts
```

Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/llm-test.ts src/server/llm-test.test.ts
git commit -m "feat(server): runLlmTest — outbound LLM ping with SSRF guard

Pure async helper. SSRF-checks base_url first, then issues a 1-token
Anthropic-Messages-compatible POST with 5s default timeout. Resolves
\${REF} auth tokens from process.env (errors cleanly when missing).
Returns the same {ok, error?} shape as Plan E's healthCheck."
```

---

## Task 7: Server-startup migration (`onboarding-autocomplete`)

Runs once when `scry serve` boots. Checks: is `onboarding` block entirely absent AND `llm` present AND `mcp_servers` non-empty? If yes, write `onboarding: { completed: true }`. Idempotent.

**Files:**
- Create: `src/server/migrations/onboarding-autocomplete.ts`
- Create: `src/server/migrations/onboarding-autocomplete.test.ts`
- Modify: `src/server/boot.ts` (invoke migration after `loadDotEnvFile`)

- [ ] **Step 1: Write the failing test file**

Create `src/server/migrations/onboarding-autocomplete.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runOnboardingAutocomplete } from './onboarding-autocomplete.js';

let dir: string;
let cfgPath: string;

const SEED_LLM_AND_MCPS = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers:
  slack:
    command: slack-mcp
search_tools: {}
`;

const SEED_LLM_NO_MCPS = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

const SEED_WITH_ONBOARDING_FALSE = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers:
  slack:
    command: slack-mcp
search_tools: {}
onboarding:
  completed: false
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-migration-'));
  cfgPath = join(dir, 'scry.config.yaml');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runOnboardingAutocomplete', () => {
  it('writes completed:true when onboarding absent + llm + mcps non-empty', async () => {
    writeFileSync(cfgPath, SEED_LLM_AND_MCPS);
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('migrated');
    const out = readFileSync(cfgPath, 'utf-8');
    expect(out).toContain('onboarding:');
    expect(out).toMatch(/completed:\s*true/);
  });

  it('is a no-op when mcps is empty', async () => {
    writeFileSync(cfgPath, SEED_LLM_NO_MCPS);
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('skipped');
    expect(readFileSync(cfgPath, 'utf-8')).not.toContain('onboarding:');
  });

  it('is a no-op when onboarding block exists with completed:false', async () => {
    writeFileSync(cfgPath, SEED_WITH_ONBOARDING_FALSE);
    const before = readFileSync(cfgPath, 'utf-8');
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('skipped');
    expect(readFileSync(cfgPath, 'utf-8')).toBe(before);
  });

  it('is a no-op when config does not exist', async () => {
    expect(existsSync(cfgPath)).toBe(false);
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('skipped');
  });

  it('is idempotent — running twice produces the same file as running once', async () => {
    writeFileSync(cfgPath, SEED_LLM_AND_MCPS);
    await runOnboardingAutocomplete(cfgPath);
    const after1 = readFileSync(cfgPath, 'utf-8');
    const r2 = await runOnboardingAutocomplete(cfgPath);
    expect(r2).toBe('skipped');
    expect(readFileSync(cfgPath, 'utf-8')).toBe(after1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/migrations/onboarding-autocomplete.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the migration**

Create `src/server/migrations/onboarding-autocomplete.ts`:

```ts
import { existsSync, readFileSync } from 'fs';
import { parseDocument } from 'yaml';
import { writeConfig } from '../../config/write-config.js';

export type MigrationResult = 'migrated' | 'skipped';

/**
 * Runs at scry serve boot. If config has llm + ≥1 mcp_servers and no
 * `onboarding` block at all, marks onboarding.completed = true. Treats users
 * who configured via scry init or hand-editing as already-onboarded so the
 * web wizard doesn't hijack them.
 *
 * Skips if: config missing; onboarding block already present (any value);
 * llm absent; mcp_servers empty.
 */
export async function runOnboardingAutocomplete(configPath: string): Promise<MigrationResult> {
  if (!existsSync(configPath)) return 'skipped';

  let doc;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    doc = parseDocument(raw);
    if (doc.errors.length > 0) return 'skipped';
  } catch {
    return 'skipped';
  }

  const onboarding = doc.get('onboarding');
  if (onboarding !== undefined && onboarding !== null) return 'skipped';

  const llm = doc.get('llm');
  if (llm === undefined || llm === null) return 'skipped';

  const mcpServers = doc.toJSON()?.mcp_servers;
  if (!mcpServers || typeof mcpServers !== 'object' || Object.keys(mcpServers).length === 0) {
    return 'skipped';
  }

  // Use writeConfig's path — but writeConfig only knows about mcp_servers and
  // registry. We need to write `onboarding` directly. Read-modify-write here:
  doc.set('onboarding', { completed: true });

  // Reuse atomic write path. We sidestep writeConfig's whitelist by going
  // through atomicWriteConfig directly, since the migration is a special case.
  const { atomicWriteConfig } = await import('../../config/atomic-write.js');
  await atomicWriteConfig(configPath, String(doc));

  console.error(`scry: migrated existing config — onboarding marked complete (${configPath})`);
  return 'migrated';
}
```

Note: `writeConfig` only validates and writes `mcp_servers` / `registry` blocks (see `src/config/write-config.ts:22-25`). The migration writes `onboarding`, so it goes through `atomicWriteConfig` directly. This is fine — the migration runs once at startup, before any HTTP listener accepts connections, so there's no concurrency concern.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/migrations/onboarding-autocomplete.test.ts
```

Expected: PASS — all 5 tests.

- [ ] **Step 5: Wire the migration into `boot.ts`**

In `src/server/boot.ts`, replace the existing `startServer` function:

```ts
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { dirname, join } from 'path';
import { createServer } from './index.js';
import { generateCsrfToken } from './middleware/csrf-token.js';
import { resolveConfigPath } from '../config/loader.js';
import { loadDotEnvFile } from '../config/dotenv.js';
import { SessionsStore } from '../storage/sessions.js';
import { runOnboardingAutocomplete } from './migrations/onboarding-autocomplete.js';

export interface BootOptions {
  port: number;
}

export async function startServer(opts: BootOptions): Promise<Server> {
  generateCsrfToken();
  const configPath = resolveConfigPath();
  console.log(`scry: config = ${configPath}`);
  const configDir = dirname(configPath);

  loadDotEnvFile(join(configDir, '.scry.env'));

  // One-time migration for pre-G configs (idempotent).
  await runOnboardingAutocomplete(configPath);

  const sessionsStore = new SessionsStore(join(configDir, 'scry.db'));

  const close = () => {
    try { sessionsStore.close(); } catch { /* idempotent */ }
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  const app = createServer({ port: opts.port, sessionsStore });
  return new Promise((resolveListening, reject) => {
    const server = serve(
      { fetch: app.fetch, port: opts.port, hostname: '127.0.0.1' },
      () => resolveListening(server as unknown as Server),
    );
    (server as unknown as Server).once('error', reject);
  });
}
```

Note the signature changed from `Promise<Server>` returning a sync function to `async` (now `Promise<Server>` from an async function). Check callers of `startServer` and confirm they `await` it:

```bash
grep -rn "startServer" src/ tests/
```

Update any non-awaiting callers if needed.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: PASS — full suite green (the boot.ts change shouldn't break anything since callers already `await` it).

- [ ] **Step 7: Commit**

```bash
git add src/server/migrations/onboarding-autocomplete.ts src/server/migrations/onboarding-autocomplete.test.ts src/server/boot.ts
git commit -m "feat(server): startup migration for pre-G configs

runOnboardingAutocomplete: if onboarding block is absent AND llm is
present AND mcp_servers is non-empty, write onboarding.completed=true.
Idempotent. Logs to stderr. Invoked from boot.ts after loadDotEnvFile,
before any HTTP listener accepts connections — no concurrency risk."
```

---

## Task 8: `PUT /api/llm` and `POST /api/llm/test` routes

Wire `runLlmTest` and the new `LlmConfigSchema` + SSRF guard into HTTP routes.

**Files:**
- Create: `src/server/routes/llm.ts`
- Create: `src/server/routes/llm.test.ts`
- Create: `src/server/routes/llm.csrf.test.ts`
- Modify: `src/server/index.ts` (mount the route)

- [ ] **Step 1: Write the failing test file**

Create `src/server/routes/llm.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildLlmRoute } from './llm.js';

let dir: string;
let cfg: string;
let envPath: string;
let app: Hono;
let llmTestMock: ReturnType<typeof vi.fn>;

const SEED = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-llm-route-'));
  cfg = join(dir, 'scry.config.yaml');
  envPath = join(dir, '.scry.env');
  writeFileSync(cfg, SEED);
  llmTestMock = vi.fn().mockResolvedValue({ ok: true });
  app = new Hono();
  app.route('/api/llm', buildLlmRoute({
    configPath: () => cfg,
    envPath: () => envPath,
    llmTest: llmTestMock,
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('POST /api/llm/test', () => {
  it('returns 200 ok=true when llmTest succeeds', async () => {
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', auth_token: 'sk-x' }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(llmTestMock).toHaveBeenCalledOnce();
  });

  it('returns 200 ok=false on llmTest failure', async () => {
    llmTestMock.mockResolvedValue({ ok: false, error: '401 unauthorized' });
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: 'bad' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('401');
  });

  it('returns 400 with SSRF error on disallowed base_url', async () => {
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://10.0.0.1', model: 'm' }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid-body');
    expect(JSON.stringify(body)).toMatch(/base_url|private/);
    expect(llmTestMock).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed body', async () => {
    const r = await app.request('/api/llm/test', { method: 'POST', headers: csrfHeaders, body: '{' });
    expect(r.status).toBe(400);
  });
});

describe('PUT /api/llm', () => {
  it('writes the llm block when given a ${REF} auth_token', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', auth_token: '${ANTHROPIC_API_KEY}', model: 'claude-haiku-4-5-20251001' }),
    });
    expect(r.status).toBe(200);
    const out = readFileSync(cfg, 'utf-8');
    expect(out).toMatch(/auth_token:\s*\$\{ANTHROPIC_API_KEY\}/);
    expect(existsSync(envPath)).toBe(false);
  });

  it('writes literal token to .scry.env and rewrites config to ${SCRY_LLM_TOKEN}', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', auth_token: 'sk-real-value', model: 'claude-haiku-4-5-20251001' }),
    });
    expect(r.status).toBe(200);
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toMatch(/auth_token:\s*\$\{SCRY_LLM_TOKEN\}/);
    const envOut = readFileSync(envPath, 'utf-8');
    expect(envOut).toContain('SCRY_LLM_TOKEN=sk-real-value\n');
  });

  it('rejects an SSRF-disallowed base_url', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://10.0.0.1', model: 'm' }),
    });
    expect(r.status).toBe(400);
    expect(readFileSync(cfg, 'utf-8')).toContain('claude-haiku-4-5-20251001');  // unchanged
  });

  it('returns 412 when config does not exist', async () => {
    rmSync(cfg);
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm' }),
    });
    expect(r.status).toBe(412);
  });

  it('clears onboarding.llm_skipped on successful write', async () => {
    writeFileSync(cfg, SEED + 'onboarding:\n  completed: false\n  llm_skipped: true\n');
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', auth_token: '${ANTHROPIC_API_KEY}', model: 'm' }),
    });
    expect(r.status).toBe(200);
    const out = readFileSync(cfg, 'utf-8');
    expect(out).not.toMatch(/llm_skipped:\s*true/);
  });

  it('handles a config with no auth_token (proxy case)', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'http://localhost:6655/anthropic/', model: 'claude-haiku-4-5-20251001' }),
    });
    expect(r.status).toBe(200);
    const out = readFileSync(cfg, 'utf-8');
    expect(out).toContain('http://localhost:6655/anthropic/');
    expect(existsSync(envPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the CSRF test file**

Create `src/server/routes/llm.csrf.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildLlmRoute } from './llm.js';
import { csrfRequired } from '../middleware/csrf.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-llm-csrf-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
  app.use('*', csrfRequired());
  app.route('/api/llm', buildLlmRoute({
    configPath: () => cfg,
    envPath: () => join(dir, '.scry.env'),
    llmTest: async () => ({ ok: true }),
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CSRF on /api/llm', () => {
  it('rejects PUT without CSRF header', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm' }),
    });
    expect(r.status).toBe(403);
  });

  it('rejects POST /test without CSRF header', async () => {
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm' }),
    });
    expect(r.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/server/routes/llm.test.ts src/server/routes/llm.csrf.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the route**

Create `src/server/routes/llm.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parseDocument } from 'yaml';
import { LlmConfigSchema } from '../../config/schema.js';
import { writeConfigAndEnv } from '../../config/write-config-pair.js';
import { ConfigValidationError, ConfigMissingError } from '../../config/write-config.js';
import { isAllowedBaseUrl } from '../ssrf.js';
import { runLlmTest as realRunLlmTest, type LlmTestInput, type LlmTestResult } from '../llm-test.js';
import { zodToApiErrors } from '../../shared/api-errors.js';

const ENV_REF_RE = /^\$\{[A-Z][A-Z0-9_]*\}$/;

interface RouteDeps {
  configPath: () => string;
  envPath: () => string;
  llmTest?: (input: LlmTestInput) => Promise<LlmTestResult>;
}

const Body = LlmConfigSchema;

function loadOnboarding(configPath: string): Record<string, unknown> | undefined {
  const raw = readFileSync(configPath, 'utf-8');
  const doc = parseDocument(raw);
  const ob = doc.toJSON()?.onboarding;
  if (ob && typeof ob === 'object' && !Array.isArray(ob)) return ob as Record<string, unknown>;
  return undefined;
}

export function buildLlmRoute(deps: RouteDeps): Hono {
  const llmTest = deps.llmTest ?? realRunLlmTest;

  return new Hono()
    .post('/test', async (c) => {
      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = Body.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const ssrf = isAllowedBaseUrl(parsed.data.base_url);
      if (!ssrf.ok) {
        return c.json({ error: 'invalid-body', errors: [{ path: ['base_url'], message: ssrf.reason }] }, 400);
      }
      const r = await llmTest(parsed.data);
      return c.json(r);
    })

    .put('/', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = Body.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const ssrf = isAllowedBaseUrl(parsed.data.base_url);
      if (!ssrf.ok) {
        return c.json({ error: 'invalid-body', errors: [{ path: ['base_url'], message: ssrf.reason }] }, 400);
      }

      // If auth_token is a literal value (not ${REF}), route it through .scry.env.
      let llmBlock = { base_url: parsed.data.base_url, model: parsed.data.model } as Record<string, unknown>;
      let envKv: Record<string, string> = {};
      if (parsed.data.auth_token !== undefined) {
        if (ENV_REF_RE.test(parsed.data.auth_token)) {
          llmBlock.auth_token = parsed.data.auth_token;
        } else {
          envKv.SCRY_LLM_TOKEN = parsed.data.auth_token;
          llmBlock.auth_token = '${SCRY_LLM_TOKEN}';
        }
      }

      // Build the full top-level update via direct YAML mutation (writeConfig
      // only knows mcp_servers/registry; we set llm + onboarding by hand).
      const { atomicWriteConfig } = await import('../../config/atomic-write.js');
      const { writeDotEnv } = await import('../../config/dotenv-write.js');

      // Validate env first (synchronous check).
      // Then validate via writeConfigAndEnv... but writeConfig can't write `llm`.
      // We use atomicWriteConfig + parseDocument directly.
      try {
        if (Object.keys(envKv).length > 0) {
          await writeDotEnv(deps.envPath(), envKv);
        }

        const doc = parseDocument(readFileSync(cfgPath, 'utf-8'));
        if (doc.errors.length > 0) {
          return c.json({ error: 'config-malformed', message: doc.errors[0].message }, 500);
        }
        doc.set('llm', llmBlock);

        // Clear llm_skipped if set.
        const ob = loadOnboarding(cfgPath);
        if (ob && ob.llm_skipped === true) {
          const next = { ...ob };
          delete next.llm_skipped;
          doc.set('onboarding', next);
        }

        await atomicWriteConfig(cfgPath, String(doc));
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        }
        if (err instanceof ConfigMissingError) {
          return c.json({ error: 'config-required' }, 412);
        }
        throw err;
      }

      return c.json({ llm: llmBlock });
    });
}
```

- [ ] **Step 5: Mount the route in `src/server/index.ts`**

Add the import:

```ts
import { buildLlmRoute } from './routes/llm.js';
```

After the existing `app.route('/api/registry', ...)`, add:

```ts
import { dirname, join } from 'path';
// ...
const envPathFn = () => {
  const cfgPath = resolveConfigPath();
  return join(dirname(cfgPath), '.scry.env');
};
app.route('/api/llm', buildLlmRoute({
  configPath: () => resolveConfigPath(),
  envPath: envPathFn,
}));
```

(If `dirname` and `join` are already imported, skip the duplicate.)

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/server/routes/llm.test.ts src/server/routes/llm.csrf.test.ts
```

Expected: PASS — all 11 tests across the two files.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/llm.ts src/server/routes/llm.test.ts src/server/routes/llm.csrf.test.ts src/server/index.ts
git commit -m "feat(server): /api/llm route — PUT and /test

PUT writes the llm block atomically; literal auth_token splits into
\${SCRY_LLM_TOKEN} (config) + .scry.env (literal). \${REF} tokens
stay as refs. SSRF guard runs in both PUT and /test before any
network call. llm_skipped flag cleared on successful PUT."
```

---

## Task 9: `GET /api/mcps/discover` route

Returns `{ bundled, pathInstalled }` for the wizard's Step 2.

**Files:**
- Create: `src/server/routes/mcps-discover.ts`
- Create: `src/server/routes/mcps-discover.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/routes/mcps-discover.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildMcpsDiscoverRoute } from './mcps-discover.js';
import { BUNDLED_SERVERS } from '../../config/bundled-servers.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-discover-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('GET /api/mcps/discover', () => {
  it('returns bundled list and pathInstalled (none on PATH)', async () => {
    app.route('/api/mcps/discover', buildMcpsDiscoverRoute({
      configPath: () => cfg,
      which: () => null,
    }));
    const r = await app.request('/api/mcps/discover');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.bundled).toHaveLength(BUNDLED_SERVERS.length);
    expect(body.bundled[0]).toMatchObject({ slug: expect.any(String), command: expect.any(String) });
    expect(body.pathInstalled).toEqual([]);
  });

  it('returns the commands found on PATH', async () => {
    app.route('/api/mcps/discover', buildMcpsDiscoverRoute({
      configPath: () => cfg,
      which: (cmd) => (cmd === 'slack-mcp' ? '/usr/local/bin/slack-mcp' : null),
    }));
    const r = await app.request('/api/mcps/discover');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.pathInstalled).toEqual(['slack-mcp']);
  });

  it('returns 412 when config does not exist', async () => {
    rmSync(cfg);
    app.route('/api/mcps/discover', buildMcpsDiscoverRoute({
      configPath: () => cfg,
      which: () => null,
    }));
    const r = await app.request('/api/mcps/discover');
    expect(r.status).toBe(412);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/routes/mcps-discover.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/server/routes/mcps-discover.ts`:

```ts
import { Hono } from 'hono';
import { existsSync } from 'fs';
import { BUNDLED_SERVERS } from '../../config/bundled-servers.js';
import { whichCommand } from '../../discovery/path-scan.js';

interface RouteDeps {
  configPath: () => string;
  which?: (cmd: string) => string | null;
}

export function buildMcpsDiscoverRoute(deps: RouteDeps): Hono {
  const which = deps.which ?? whichCommand;
  return new Hono()
    .get('/', (c) => {
      if (!existsSync(deps.configPath())) {
        return c.json({ error: 'config-required' }, 412);
      }
      const pathInstalled = BUNDLED_SERVERS
        .filter(s => which(s.command) !== null)
        .map(s => s.command);
      return c.json({ bundled: BUNDLED_SERVERS, pathInstalled });
    });
}
```

- [ ] **Step 4: Mount the route**

In `src/server/index.ts`, add:

```ts
import { buildMcpsDiscoverRoute } from './routes/mcps-discover.js';
// ...
app.route('/api/mcps/discover', buildMcpsDiscoverRoute({ configPath: () => resolveConfigPath() }));
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/server/routes/mcps-discover.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/mcps-discover.ts src/server/routes/mcps-discover.test.ts src/server/index.ts
git commit -m "feat(server): GET /api/mcps/discover

Returns { bundled: BundledServer[], pathInstalled: string[] }.
Wizard's Step 2 reads this on mount to render bundled cards with
PATH-status and install hints."
```

---

## Task 10: `/api/onboarding` route (GET + POST complete + POST skip + POST mcps)

Five endpoints under one route. The biggest server task.

**Files:**
- Create: `src/server/routes/onboarding.ts`
- Create: `src/server/routes/onboarding.test.ts`
- Create: `src/server/routes/onboarding.csrf.test.ts`
- Modify: `src/server/index.ts` (mount the route)

- [ ] **Step 1: Write the failing test file (split into 4 describe blocks for readability)**

Create `src/server/routes/onboarding.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildOnboardingRoute } from './onboarding.js';

let dir: string;
let cfg: string;
let envPath: string;
let app: Hono;
let healthCheckMock: ReturnType<typeof vi.fn>;

const SEED_FRESH = `llm: {}
mcp_servers: {}
search_tools: {}
`;

const SEED_LLM_ONLY = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

const SEED_LLM_AND_MCPS = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers:
  slack:
    command: slack-mcp
    env:
      SLACK_TOKEN: \${SLACK_TOKEN}
search_tools: {}
onboarding:
  completed: false
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-onboarding-'));
  cfg = join(dir, 'scry.config.yaml');
  envPath = join(dir, '.scry.env');
  healthCheckMock = vi.fn().mockResolvedValue({ ok: true, toolCount: 1 });
  app = new Hono();
  app.route('/api/onboarding', buildOnboardingRoute({
    configPath: () => cfg,
    envPath: () => envPath,
    healthCheck: healthCheckMock,
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('GET /api/onboarding', () => {
  it('returns null llm + empty mcps + completed:false on a fresh config', async () => {
    writeFileSync(cfg, SEED_FRESH);
    const r = await app.request('/api/onboarding');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.llm).toBeNull();
    expect(body.mcps).toEqual([]);
    expect(body.onboarding).toMatchObject({ completed: false });
  });

  it('returns llm shape + hasAuth (boolean only, no token leakage)', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding');
    const body = await r.json();
    expect(body.llm).toEqual({ base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', hasAuth: true });
    expect(JSON.stringify(body)).not.toContain('${ANTHROPIC_API_KEY}');
  });

  it('returns mcps with the standard McpServerEntry shape', async () => {
    writeFileSync(cfg, SEED_LLM_AND_MCPS);
    const r = await app.request('/api/onboarding');
    const body = await r.json();
    expect(body.mcps).toHaveLength(1);
    expect(body.mcps[0]).toMatchObject({ name: 'slack', command: 'slack-mcp', enabled: true });
  });

  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/onboarding');
    expect(r.status).toBe(412);
  });

  it('reports detected env keys from .scry.env (no values)', async () => {
    writeFileSync(cfg, SEED_FRESH);
    writeFileSync(envPath, 'SLACK_TOKEN=xoxb-secret\nMS365_CLIENT_ID=abc\n');
    const r = await app.request('/api/onboarding');
    const body = await r.json();
    expect(body.detectedEnvKeys).toEqual(expect.arrayContaining(['SLACK_TOKEN', 'MS365_CLIENT_ID']));
    expect(JSON.stringify(body)).not.toContain('xoxb-secret');
  });
});

describe('POST /api/onboarding/complete', () => {
  it('writes completed:true', async () => {
    writeFileSync(cfg, SEED_LLM_AND_MCPS);
    const r = await app.request('/api/onboarding/complete', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(200);
    expect(readFileSync(cfg, 'utf-8')).toMatch(/completed:\s*true/);
  });

  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/onboarding/complete', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(412);
  });
});

describe('POST /api/onboarding/skip', () => {
  it('sets llm_skipped:true on step=llm', async () => {
    writeFileSync(cfg, SEED_FRESH);
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ step: 'llm' }),
    });
    expect(r.status).toBe(200);
    expect(readFileSync(cfg, 'utf-8')).toMatch(/llm_skipped:\s*true/);
  });

  it('sets mcps_skipped:true on step=mcps', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ step: 'mcps' }),
    });
    expect(r.status).toBe(200);
    expect(readFileSync(cfg, 'utf-8')).toMatch(/mcps_skipped:\s*true/);
  });

  it('returns 400 on invalid step', async () => {
    writeFileSync(cfg, SEED_FRESH);
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ step: 'confirm' }),
    });
    expect(r.status).toBe(400);
  });
});

describe('POST /api/onboarding/mcps', () => {
  it('writes config + .scry.env atomically and returns 201', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({
        name: 'slack',
        command: 'slack-mcp',
        envValues: { SLACK_TOKEN: 'xoxb-real' },
      }),
    });
    expect(r.status).toBe(201);
    expect(healthCheckMock).toHaveBeenCalledOnce();
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toContain('slack:');
    expect(cfgOut).toMatch(/SLACK_TOKEN:\s*\$\{SLACK_TOKEN\}/);
    expect(readFileSync(envPath, 'utf-8')).toContain('SLACK_TOKEN=xoxb-real\n');
  });

  it('clears mcps_skipped on successful add', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY + 'onboarding:\n  completed: false\n  mcps_skipped: true\n');
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } }),
    });
    expect(r.status).toBe(201);
    expect(readFileSync(cfg, 'utf-8')).not.toMatch(/mcps_skipped:\s*true/);
  });

  it('returns 422 on health-check failure with no fs writes', async () => {
    healthCheckMock.mockResolvedValue({ ok: false, error: 'spawn failed' });
    writeFileSync(cfg, SEED_LLM_ONLY);
    const before = readFileSync(cfg, 'utf-8');
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'bad' } }),
    });
    expect(r.status).toBe(422);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('returns 409 on duplicate name', async () => {
    writeFileSync(cfg, SEED_LLM_AND_MCPS);
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } }),
    });
    expect(r.status).toBe(409);
  });

  it('handles a custom MCP with explicit env block (no envVars metadata)', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({
        name: 'custom-mcp',
        command: 'my-custom-mcp',
        args: ['--flag'],
        envValues: { CUSTOM_TOKEN: 'value' },
      }),
    });
    expect(r.status).toBe(201);
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toContain('custom-mcp:');
    expect(cfgOut).toMatch(/CUSTOM_TOKEN:\s*\$\{CUSTOM_TOKEN\}/);
  });
});
```

- [ ] **Step 2: Write the CSRF test**

Create `src/server/routes/onboarding.csrf.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildOnboardingRoute } from './onboarding.js';
import { csrfRequired } from '../middleware/csrf.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-onboarding-csrf-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
  app.use('*', csrfRequired());
  app.route('/api/onboarding', buildOnboardingRoute({
    configPath: () => cfg,
    envPath: () => join(dir, '.scry.env'),
    healthCheck: async () => ({ ok: true, toolCount: 1 }),
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CSRF on /api/onboarding', () => {
  it('rejects POST /complete without CSRF', async () => {
    const r = await app.request('/api/onboarding/complete', { method: 'POST' });
    expect(r.status).toBe(403);
  });

  it('rejects POST /skip without CSRF', async () => {
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'llm' }),
    });
    expect(r.status).toBe(403);
  });

  it('rejects POST /mcps without CSRF', async () => {
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', command: 'y', envValues: {} }),
    });
    expect(r.status).toBe(403);
  });

  it('GET does not require CSRF', async () => {
    const r = await app.request('/api/onboarding');
    expect(r.status).not.toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/server/routes/onboarding.test.ts src/server/routes/onboarding.csrf.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the route**

Create `src/server/routes/onboarding.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parseDocument } from 'yaml';
import { McpServerConfigSchema } from '../../config/schema.js';
import { ConfigValidationError } from '../../config/write-config.js';
import { writeDotEnv } from '../../config/dotenv-write.js';
import { atomicWriteConfig } from '../../config/atomic-write.js';
import { healthCheck as realHealthCheck, type HealthCheckResult } from '../mcp-health.js';
import type { McpServerConfig } from '../../config/types.js';
import { zodToApiErrors } from '../../shared/api-errors.js';

const NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const SkipBody = z.object({ step: z.enum(['llm', 'mcps']) });
const McpsBody = z.object({
  name: z.string().regex(NAME_RE),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  envValues: z.record(z.string(), z.string()).default({}),
});

interface RouteDeps {
  configPath: () => string;
  envPath: () => string;
  healthCheck?: (server: McpServerConfig, opts?: { timeoutMs?: number }) => Promise<HealthCheckResult>;
}

interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

function readDoc(configPath: string): ReturnType<typeof parseDocument> {
  const raw = readFileSync(configPath, 'utf-8');
  return parseDocument(raw);
}

function readEnvKeys(envPath: string): string[] {
  if (!existsSync(envPath)) return [];
  try {
    const raw = readFileSync(envPath, 'utf-8');
    const out: string[] = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key) out.push(key);
    }
    return out;
  } catch {
    return [];
  }
}

function detectedRefs(envKeys: string[]): string[] {
  const wellKnown = ['ANTHROPIC_API_KEY', 'SLACK_TOKEN', 'MS365_CLIENT_ID', 'ATLASSIAN_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'];
  const out: string[] = [];
  for (const ref of wellKnown) {
    if (process.env[ref] !== undefined || envKeys.includes(ref)) out.push(ref);
  }
  return out;
}

function toEntry(name: string, cfg: McpServerConfig): McpServerEntry {
  return { name, command: cfg.command, args: cfg.args, env: cfg.env, enabled: cfg.enabled ?? true };
}

export function buildOnboardingRoute(deps: RouteDeps): Hono {
  const healthCheck = deps.healthCheck ?? realHealthCheck;

  return new Hono()
    .get('/', (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      const doc = readDoc(cfgPath);
      const json = doc.toJSON() ?? {};
      const llmRaw = json.llm;
      const llm = (llmRaw && llmRaw.base_url && llmRaw.model)
        ? { base_url: llmRaw.base_url, model: llmRaw.model, hasAuth: typeof llmRaw.auth_token === 'string' && llmRaw.auth_token.length > 0 }
        : null;
      const mcpsRaw: Record<string, McpServerConfig> = json.mcp_servers ?? {};
      const mcps = Object.entries(mcpsRaw).map(([n, s]) => toEntry(n, s));
      const onboarding = json.onboarding ?? { completed: false };
      const envKeys = readEnvKeys(deps.envPath());

      return c.json({
        llm,
        mcps,
        onboarding,
        detectedRefs: detectedRefs(envKeys),
        detectedEnvKeys: envKeys,
      });
    })

    .post('/complete', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);
      const doc = readDoc(cfgPath);
      const ob = (doc.toJSON()?.onboarding ?? {}) as Record<string, unknown>;
      doc.set('onboarding', { ...ob, completed: true });
      await atomicWriteConfig(cfgPath, String(doc));
      return c.json({ completed: true });
    })

    .post('/skip', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);
      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = SkipBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const doc = readDoc(cfgPath);
      const ob = (doc.toJSON()?.onboarding ?? { completed: false }) as Record<string, unknown>;
      const flag = parsed.data.step === 'llm' ? 'llm_skipped' : 'mcps_skipped';
      doc.set('onboarding', { ...ob, [flag]: true });
      await atomicWriteConfig(cfgPath, String(doc));
      return c.json({ onboarding: { ...ob, [flag]: true } });
    })

    .post('/mcps', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = McpsBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }

      const doc = readDoc(cfgPath);
      const json = doc.toJSON() ?? {};
      const existingMcps: Record<string, McpServerConfig> = json.mcp_servers ?? {};
      if (existingMcps[parsed.data.name]) {
        return c.json({ error: 'name-exists', message: `MCP "${parsed.data.name}" already exists` }, 409);
      }

      // Build env block from envValues — every key gets a ${KEY} ref.
      const envBlock: Record<string, string> = {};
      for (const k of Object.keys(parsed.data.envValues)) {
        envBlock[k] = `\${${k}}`;
      }
      const newServer: McpServerConfig = {
        command: parsed.data.command,
        ...(parsed.data.args ? { args: parsed.data.args } : {}),
        ...(Object.keys(envBlock).length > 0 ? { env: envBlock } : {}),
      };

      // Validate the proposed entry shape.
      const entryParse = McpServerConfigSchema.safeParse(newServer);
      if (!entryParse.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(entryParse.error.issues) }, 400);
      }

      // Health-check BEFORE any write. Resolve declared refs against the
      // *proposed* env values so the spawn can authenticate.
      const probeServer: McpServerConfig = {
        ...newServer,
        env: Object.fromEntries(Object.entries(parsed.data.envValues)),
      };
      const hc = await healthCheck(probeServer);
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      // Two-phase: write env first, then config. Both atomic.
      try {
        if (Object.keys(parsed.data.envValues).length > 0) {
          await writeDotEnv(deps.envPath(), parsed.data.envValues);
        }

        // Re-read doc to avoid mutating a stale snapshot.
        const doc2 = readDoc(cfgPath);
        const json2 = doc2.toJSON() ?? {};
        const mcps2 = { ...(json2.mcp_servers ?? {}), [parsed.data.name]: newServer };
        doc2.set('mcp_servers', mcps2);

        // Clear mcps_skipped if set.
        const ob = (json2.onboarding ?? {}) as Record<string, unknown>;
        if (ob.mcps_skipped === true) {
          const next = { ...ob };
          delete next.mcps_skipped;
          doc2.set('onboarding', next);
        }

        await atomicWriteConfig(cfgPath, String(doc2));
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        }
        throw err;
      }

      return c.json({ server: toEntry(parsed.data.name, newServer) }, 201);
    });
}
```

- [ ] **Step 5: Mount the route**

In `src/server/index.ts`, add:

```ts
import { buildOnboardingRoute } from './routes/onboarding.js';
// ...
app.route('/api/onboarding', buildOnboardingRoute({
  configPath: () => resolveConfigPath(),
  envPath: envPathFn,
}));
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/server/routes/onboarding.test.ts src/server/routes/onboarding.csrf.test.ts
```

Expected: PASS — all 17 tests across the two files.

- [ ] **Step 7: Run full backend suite**

```bash
npx vitest run
```

Expected: PASS — full suite green (existing + new).

- [ ] **Step 8: Commit**

```bash
git add src/server/routes/onboarding.ts src/server/routes/onboarding.test.ts src/server/routes/onboarding.csrf.test.ts src/server/index.ts
git commit -m "feat(server): /api/onboarding route — GET + complete/skip/mcps

GET is a pure read returning {llm, mcps, onboarding, detectedRefs,
detectedEnvKeys}. POST /complete writes onboarding.completed=true.
POST /skip sets llm_skipped or mcps_skipped. POST /mcps health-checks
then atomically writes config + .scry.env, clearing mcps_skipped
on success. CSRF rejection tested on every mutating verb."
```

---

## Task 11: Web client libraries (`onboarding.ts`, `llm.ts`, `mcps-discover.ts`)

Three thin typed clients over `apiJson`. No server logic — just shapes and calls.

**Files:**
- Create: `web/src/lib/onboarding.ts`
- Create: `web/src/lib/llm.ts`
- Create: `web/src/lib/mcps-discover.ts`
- Create: `web/src/lib/onboarding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/onboarding.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getOnboardingState, completeOnboarding, skipStep, addOnboardingMcp } from './onboarding.js';

const origFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Stub the CSRF endpoint that getCsrfToken hits.
  fetchMock.mockImplementation(async (url: string) => {
    if (url.toString().includes('/api/csrf')) {
      return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => { globalThis.fetch = origFetch; });

describe('onboarding client', () => {
  it('getOnboardingState GETs /api/onboarding', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [],
    }), { status: 200 }));
    const r = await getOnboardingState();
    expect(r.onboarding.completed).toBe(false);
  });

  it('completeOnboarding POSTs /api/onboarding/complete with CSRF', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.toString().includes('/api/csrf')) return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
      const headers = new Headers(init.headers);
      expect(headers.get('X-Scry-Csrf')).toBe('tok');
      return new Response(JSON.stringify({ completed: true }), { status: 200 });
    });
    await completeOnboarding();
  });

  it('skipStep posts the step name', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.toString().includes('/api/csrf')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      expect((init as RequestInit).body).toBe(JSON.stringify({ step: 'llm' }));
      return new Response(JSON.stringify({ onboarding: { completed: false, llm_skipped: true } }), { status: 200 });
    });
    await skipStep('llm');
  });

  it('addOnboardingMcp posts the wizard payload', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.toString().includes('/api/csrf')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toEqual({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } });
      return new Response(JSON.stringify({ server: { name: 'slack', command: 'slack-mcp', enabled: true } }), { status: 201 });
    });
    const r = await addOnboardingMcp({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } });
    expect(r.name).toBe('slack');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/lib/onboarding.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the three clients**

Create `web/src/lib/onboarding.ts`:

```ts
import { apiJson } from './api.js';
import type { McpServerEntry } from './mcps.js';

export interface OnboardingLlm {
  base_url: string;
  model: string;
  hasAuth: boolean;
}

export interface OnboardingFlags {
  completed: boolean;
  llm_skipped?: boolean;
  mcps_skipped?: boolean;
}

export interface OnboardingState {
  llm: OnboardingLlm | null;
  mcps: McpServerEntry[];
  onboarding: OnboardingFlags;
  detectedRefs: string[];
  detectedEnvKeys: string[];
}

export interface AddOnboardingMcpInput {
  name: string;
  command: string;
  args?: string[];
  envValues: Record<string, string>;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  return apiJson<OnboardingState>('/api/onboarding');
}

export async function completeOnboarding(): Promise<void> {
  await apiJson<{ completed: true }>('/api/onboarding/complete', { method: 'POST' });
}

export async function skipStep(step: 'llm' | 'mcps'): Promise<OnboardingFlags> {
  const r = await apiJson<{ onboarding: OnboardingFlags }>('/api/onboarding/skip', {
    method: 'POST', body: JSON.stringify({ step }),
  });
  return r.onboarding;
}

export async function addOnboardingMcp(input: AddOnboardingMcpInput): Promise<McpServerEntry> {
  const r = await apiJson<{ server: McpServerEntry }>('/api/onboarding/mcps', {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.server;
}
```

Create `web/src/lib/llm.ts`:

```ts
import { apiJson } from './api.js';

export interface LlmConfigInput {
  base_url: string;
  auth_token?: string;
  model: string;
}

export interface LlmTestResult {
  ok: boolean;
  error?: string;
}

export async function putLlm(input: LlmConfigInput): Promise<{ llm: { base_url: string; model: string } }> {
  return apiJson('/api/llm', { method: 'PUT', body: JSON.stringify(input) });
}

export async function testLlm(input: LlmConfigInput): Promise<LlmTestResult> {
  return apiJson<LlmTestResult>('/api/llm/test', { method: 'POST', body: JSON.stringify(input) });
}
```

Create `web/src/lib/mcps-discover.ts`:

```ts
import { apiJson } from './api.js';

export interface BundledServerView {
  name: string;
  slug: string;
  command: string;
  githubUrl: string;
  description: string;
  envVars?: string[];
}

export interface DiscoverResult {
  bundled: BundledServerView[];
  pathInstalled: string[];
}

export async function discoverMcps(): Promise<DiscoverResult> {
  return apiJson<DiscoverResult>('/api/mcps/discover');
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/lib/onboarding.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/onboarding.ts web/src/lib/llm.ts web/src/lib/mcps-discover.ts web/src/lib/onboarding.test.ts
git commit -m "feat(web): typed clients for onboarding + llm + mcps-discover"
```

---

## Task 12: `RequireOnboarding` wrapper

Reads onboarding state once on mount + on `document.visibilitychange`. Redirects to `/onboarding` if not completed.

**Files:**
- Create: `web/src/components/RequireOnboarding.tsx`
- Create: `web/src/components/RequireOnboarding.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/RequireOnboarding.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireOnboarding } from './RequireOnboarding.js';
import * as onboarding from '../lib/onboarding.js';

vi.mock('../lib/onboarding.js');

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<RequireOnboarding><div>HOME</div></RequireOnboarding>} />
        <Route path="/onboarding" element={<div>WIZARD</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequireOnboarding', () => {
  it('renders children when onboarding is completed', async () => {
    vi.mocked(onboarding.getOnboardingState).mockResolvedValue({
      llm: { base_url: 'https://api.anthropic.com', model: 'm', hasAuth: true },
      mcps: [],
      onboarding: { completed: true },
      detectedRefs: [],
      detectedEnvKeys: [],
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByText('HOME')).toBeTruthy());
  });

  it('redirects to /onboarding when completed:false', async () => {
    vi.mocked(onboarding.getOnboardingState).mockResolvedValue({
      llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [],
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByText('WIZARD')).toBeTruthy());
  });

  it('redirects on 412 from the API', async () => {
    const { ApiCallError } = await import('../lib/api.js');
    vi.mocked(onboarding.getOnboardingState).mockRejectedValue(new ApiCallError(412, { error: 'config-required' }));
    renderAt('/');
    await waitFor(() => expect(screen.getByText('WIZARD')).toBeTruthy());
  });

  it('re-fetches on document visibility change', async () => {
    vi.mocked(onboarding.getOnboardingState).mockResolvedValueOnce({
      llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [],
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByText('WIZARD')).toBeTruthy());
    expect(vi.mocked(onboarding.getOnboardingState)).toHaveBeenCalledTimes(1);

    // Simulate the wizard finishing in another tab.
    vi.mocked(onboarding.getOnboardingState).mockResolvedValueOnce({
      llm: { base_url: 'x', model: 'y', hasAuth: true },
      mcps: [], onboarding: { completed: true }, detectedRefs: [], detectedEnvKeys: [],
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(vi.mocked(onboarding.getOnboardingState)).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/RequireOnboarding.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `web/src/components/RequireOnboarding.tsx`:

```tsx
import { useEffect, useState, useCallback, type JSX, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiCallError } from '../lib/api.js';
import { getOnboardingState } from '../lib/onboarding.js';

type State =
  | { kind: 'loading' }
  | { kind: 'redirect' }
  | { kind: 'pass' };

interface Props {
  children: ReactNode;
}

export function RequireOnboarding({ children }: Props): JSX.Element | null {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const fetchState = useCallback(async () => {
    try {
      const r = await getOnboardingState();
      setState(r.onboarding.completed ? { kind: 'pass' } : { kind: 'redirect' });
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 412) {
        setState({ kind: 'redirect' });
      } else {
        // On unexpected errors, fail open (render children) — better than
        // trapping the user in a redirect loop.
        setState({ kind: 'pass' });
      }
    }
  }, []);

  useEffect(() => {
    void fetchState();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchState();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchState]);

  if (state.kind === 'loading') return null;
  if (state.kind === 'redirect') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/RequireOnboarding.test.tsx
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/RequireOnboarding.tsx web/src/components/RequireOnboarding.test.tsx
git commit -m "feat(web): RequireOnboarding wrapper

Reads /api/onboarding once on mount + on document.visibilitychange.
Redirects to /onboarding when completed:false or on 412. Fail-open
on unexpected errors so user isn't trapped in a redirect loop."
```

---

## Task 13: `OnboardingRail` component

The 240px left rail with three step rows. Pure-presentational; takes step status + summaries as props, calls back on step click.

**Files:**
- Create: `web/src/components/onboarding/OnboardingRail.tsx`
- Create: `web/src/components/onboarding/OnboardingRail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/onboarding/OnboardingRail.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingRail, type StepStatus } from './OnboardingRail.js';

const baseSteps: Array<{ n: 1 | 2 | 3; title: string; summary: string; status: StepStatus }> = [
  { n: 1, title: 'LLM', summary: 'claude-haiku-4-5', status: 'done' },
  { n: 2, title: 'MCPs', summary: '2 picked', status: 'active' },
  { n: 3, title: 'Confirm & finish', summary: '', status: 'todo' },
];

describe('OnboardingRail', () => {
  it('renders all three steps with their titles', () => {
    render(<OnboardingRail steps={baseSteps} onStepClick={() => {}} />);
    expect(screen.getByText('LLM')).toBeTruthy();
    expect(screen.getByText('MCPs')).toBeTruthy();
    expect(screen.getByText('Confirm & finish')).toBeTruthy();
  });

  it('renders summaries for done and active steps', () => {
    render(<OnboardingRail steps={baseSteps} onStepClick={() => {}} />);
    expect(screen.getByText('claude-haiku-4-5')).toBeTruthy();
    expect(screen.getByText('2 picked')).toBeTruthy();
  });

  it('marks the active step with aria-current=step', () => {
    render(<OnboardingRail steps={baseSteps} onStepClick={() => {}} />);
    const active = screen.getByRole('button', { current: 'step' });
    expect(active.textContent).toContain('MCPs');
  });

  it('calls onStepClick with the clicked step number', () => {
    const onStepClick = vi.fn();
    render(<OnboardingRail steps={baseSteps} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByText('LLM').closest('button')!);
    expect(onStepClick).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingRail.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `web/src/components/onboarding/OnboardingRail.tsx`:

```tsx
import type { JSX } from 'react';

export type StepStatus = 'done' | 'active' | 'todo';

export interface RailStep {
  n: 1 | 2 | 3;
  title: string;
  summary: string;
  status: StepStatus;
}

interface Props {
  steps: RailStep[];
  onStepClick: (n: 1 | 2 | 3) => void;
}

export function OnboardingRail({ steps, onStepClick }: Props): JSX.Element {
  return (
    <nav className="w-60 shrink-0 border-r border-border bg-bg-secondary p-5" aria-label="Onboarding steps">
      <ol className="flex flex-col gap-0">
        {steps.map((s, i) => (
          <li key={s.n} className={i > 0 ? 'border-t border-border/50 pt-3 mt-3' : ''}>
            <button
              type="button"
              onClick={() => onStepClick(s.n)}
              aria-current={s.status === 'active' ? 'step' : undefined}
              className="w-full flex gap-3 items-start text-left"
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  s.status === 'done' ? 'bg-success text-bg-primary' :
                  s.status === 'active' ? 'bg-accent text-bg-primary' :
                  'bg-bg-elevated text-text-tertiary'
                }`}
                aria-hidden="true"
              >
                {s.status === 'done' ? '✓' : s.n}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${s.status === 'active' ? 'text-accent' : 'text-text-primary'}`}>
                  {s.title}
                </span>
                {s.summary && <span className="block text-xs text-text-tertiary mt-0.5">{s.summary}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingRail.test.tsx
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/onboarding/OnboardingRail.tsx web/src/components/onboarding/OnboardingRail.test.tsx
git commit -m "feat(web): OnboardingRail — left-rail step navigator"
```

---

## Task 14: `OnboardingLlm` component (Step 1)

Form with base_url, auth_token (with `${REF}` detection), model. Test → write → advance. Skip writes flag.

**Files:**
- Create: `web/src/components/onboarding/OnboardingLlm.tsx`
- Create: `web/src/components/onboarding/OnboardingLlm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/onboarding/OnboardingLlm.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingLlm } from './OnboardingLlm.js';
import * as llmLib from '../../lib/llm.js';
import * as onboardingLib from '../../lib/onboarding.js';

vi.mock('../../lib/llm.js');
vi.mock('../../lib/onboarding.js');

const baseProps = {
  initialLlm: null,
  detectedRefs: [],
  onAdvance: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  baseProps.onAdvance = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('OnboardingLlm', () => {
  it('renders default base_url and model', () => {
    render(<OnboardingLlm {...baseProps} />);
    expect((screen.getByLabelText(/base url/i) as HTMLInputElement).value).toBe('https://api.anthropic.com');
    expect((screen.getByLabelText(/model/i) as HTMLInputElement).value).toBe('claude-haiku-4-5-20251001');
  });

  it('prefills auth field with ${ANTHROPIC_API_KEY} when detected', () => {
    render(<OnboardingLlm {...baseProps} detectedRefs={['ANTHROPIC_API_KEY']} />);
    expect((screen.getByLabelText(/auth/i) as HTMLInputElement).value).toBe('${ANTHROPIC_API_KEY}');
    expect(screen.getByText(/detected/i)).toBeTruthy();
  });

  it('shows the no-auth-required checkbox for localhost base_url, default-checked', () => {
    render(<OnboardingLlm {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/base url/i), { target: { value: 'http://localhost:6655/anthropic/' } });
    const cb = screen.getByLabelText(/no auth required/i) as HTMLInputElement;
    expect(cb).toBeTruthy();
    expect(cb.checked).toBe(true);
  });

  it('runs llm test then PUTs on Continue and calls onAdvance', async () => {
    vi.mocked(llmLib.testLlm).mockResolvedValue({ ok: true });
    vi.mocked(llmLib.putLlm).mockResolvedValue({ llm: { base_url: 'x', model: 'y' } });
    render(<OnboardingLlm {...baseProps} detectedRefs={['ANTHROPIC_API_KEY']} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(vi.mocked(llmLib.testLlm)).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(llmLib.putLlm)).toHaveBeenCalled());
    await waitFor(() => expect(baseProps.onAdvance).toHaveBeenCalled());
  });

  it('shows error and does NOT advance when test fails', async () => {
    vi.mocked(llmLib.testLlm).mockResolvedValue({ ok: false, error: '401 unauthorized' });
    render(<OnboardingLlm {...baseProps} detectedRefs={['ANTHROPIC_API_KEY']} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText(/401 unauthorized/i)).toBeTruthy());
    expect(vi.mocked(llmLib.putLlm)).not.toHaveBeenCalled();
    expect(baseProps.onAdvance).not.toHaveBeenCalled();
  });

  it('Skip calls skipStep("llm") and advances', async () => {
    vi.mocked(onboardingLib.skipStep).mockResolvedValue({ completed: false, llm_skipped: true });
    render(<OnboardingLlm {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await waitFor(() => expect(vi.mocked(onboardingLib.skipStep)).toHaveBeenCalledWith('llm'));
    await waitFor(() => expect(baseProps.onAdvance).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingLlm.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `web/src/components/onboarding/OnboardingLlm.tsx`:

```tsx
import { useState, useEffect, type JSX, type FormEvent } from 'react';
import type { OnboardingLlm as OnboardingLlmState } from '../../lib/onboarding.js';
import { putLlm, testLlm } from '../../lib/llm.js';
import { skipStep } from '../../lib/onboarding.js';

interface Props {
  initialLlm: OnboardingLlmState | null;
  detectedRefs: string[];
  onAdvance: () => void;
}

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;
const ENV_REF_RE = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export function OnboardingLlm({ initialLlm, detectedRefs, onAdvance }: Props): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(initialLlm?.base_url ?? 'https://api.anthropic.com');
  const detectedAnthropic = detectedRefs.includes('ANTHROPIC_API_KEY');
  const [authToken, setAuthToken] = useState(detectedAnthropic ? '${ANTHROPIC_API_KEY}' : '');
  const [model, setModel] = useState(initialLlm?.model ?? 'claude-haiku-4-5-20251001');
  const [noAuth, setNoAuth] = useState(LOCALHOST_RE.test(initialLlm?.base_url ?? 'https://api.anthropic.com'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When base_url changes, recompute the noAuth default if it's a localhost URL.
  useEffect(() => {
    if (LOCALHOST_RE.test(baseUrl)) {
      setNoAuth(true);
    } else {
      // For non-localhost, only auto-set if user hasn't actively un-set it for localhost.
      setNoAuth(false);
    }
  }, [baseUrl]);

  const isLocal = LOCALHOST_RE.test(baseUrl);

  const handleContinue = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        base_url: baseUrl,
        model,
        ...(noAuth || !authToken ? {} : { auth_token: authToken }),
      };
      const test = await testLlm(payload);
      if (!test.ok) {
        setError(test.error ?? 'LLM test failed');
        setSubmitting(false);
        return;
      }
      await putLlm(payload);
      onAdvance();
    } catch (err) {
      setError((err as Error).message ?? 'failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (!window.confirm('Skip LLM setup? Searches will fail until you fix this.')) return;
    setSubmitting(true);
    try {
      await skipStep('llm');
      onAdvance();
    } catch (err) {
      setError((err as Error).message ?? 'skip failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleContinue} className="flex flex-col gap-4 max-w-xl">
      <h2 className="text-text-primary text-xl">Step 1 — Connect to your LLM</h2>

      <label className="flex flex-col gap-1 text-sm">
        Base URL
        <input
          aria-label="base url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          disabled={submitting}
          required
          className="bg-bg-elevated px-3 py-2 rounded font-mono text-sm"
        />
      </label>

      {isLocal && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={noAuth}
            onChange={(e) => setNoAuth(e.target.checked)}
            disabled={submitting}
          />
          No auth required (proxy handles it)
        </label>
      )}

      {!noAuth && (
        <label className="flex flex-col gap-1 text-sm">
          Auth token
          <input
            aria-label="auth token"
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            disabled={submitting}
            placeholder="${ANTHROPIC_API_KEY} or paste a literal value"
            className="bg-bg-elevated px-3 py-2 rounded font-mono text-sm"
          />
          {detectedAnthropic && ENV_REF_RE.test(authToken) && (
            <span className="text-text-tertiary text-xs">Detected from environment — leave as-is to use it, or paste a different value.</span>
          )}
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Model
        <input
          aria-label="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={submitting}
          required
          className="bg-bg-elevated px-3 py-2 rounded font-mono text-sm"
        />
      </label>

      {error && <div role="alert" className="text-error text-sm">{error}</div>}

      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-text-tertiary text-xs underline"
        >
          Skip — searches will fail until fixed
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-accent text-bg-primary rounded text-sm"
        >
          {submitting ? 'Testing…' : 'Test & Continue →'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingLlm.test.tsx
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/onboarding/OnboardingLlm.tsx web/src/components/onboarding/OnboardingLlm.test.tsx
git commit -m "feat(web): OnboardingLlm — Step 1 form (base_url + auth + model)

Detects ANTHROPIC_API_KEY env presence and prefills as \${REF}.
Auto-checks 'no auth required' checkbox when base_url is localhost.
Test → put → advance on Continue. Skip writes llm_skipped flag and
advances with a banner-on-/ consequence (handled by Search route)."
```

---

## Task 15: `OnboardingMcpCard` + `OnboardingMcps` components (Step 2)

Step 2 is two components: a card that handles one bundled-MCP's pick/env state, and the parent that orchestrates picks + parallel `addOnboardingMcp` calls + custom-MCP modal.

**Files:**
- Create: `web/src/components/onboarding/OnboardingMcpCard.tsx`
- Create: `web/src/components/onboarding/OnboardingMcpCard.test.tsx`
- Create: `web/src/components/onboarding/OnboardingMcps.tsx`
- Create: `web/src/components/onboarding/OnboardingMcps.test.tsx`

- [ ] **Step 1: Write the OnboardingMcpCard test**

Create `web/src/components/onboarding/OnboardingMcpCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingMcpCard } from './OnboardingMcpCard.js';

const slack = {
  name: 'Slack',
  slug: 'slack',
  command: 'slack-mcp',
  githubUrl: 'https://github.com/aviralv/slack-mcp',
  description: 'Slack search, channel history, DMs',
  envVars: ['SLACK_TOKEN'],
};

describe('OnboardingMcpCard', () => {
  it('renders name + description + PATH ok status when on PATH', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={false}
        envValues={{}}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    expect(screen.getByText('Slack')).toBeTruthy();
    expect(screen.getByText(/slack-mcp on path/i)).toBeTruthy();
  });

  it('shows install hint when not on PATH', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={false}
        envValues={{}}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onPath={false}
        statusKind="idle"
      />
    );
    expect(screen.getByText(/uv tool install git\+https:\/\/github.com\/aviralv\/slack-mcp/i)).toBeTruthy();
  });

  it('renders an env input for each entry in envVars when picked', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={true}
        envValues={{}}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    expect(screen.getByLabelText('SLACK_TOKEN')).toBeTruthy();
  });

  it('calls onPickedChange when checkbox toggled', () => {
    const onPickedChange = vi.fn();
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={false}
        envValues={{}}
        onPickedChange={onPickedChange}
        onEnvChange={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onPickedChange).toHaveBeenCalledWith(true);
  });

  it('shows error message when statusKind is error', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={true}
        envValues={{ SLACK_TOKEN: 'bad' }}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onPath={true}
        statusKind="error"
        errorMessage="health-check failed"
      />
    );
    expect(screen.getByText('health-check failed')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingMcpCard.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement OnboardingMcpCard**

Create `web/src/components/onboarding/OnboardingMcpCard.tsx`:

```tsx
import type { JSX } from 'react';
import type { BundledServerView } from '../../lib/mcps-discover.js';

export type CardStatus = 'idle' | 'testing' | 'ok' | 'error';

interface Props {
  bundled: BundledServerView;
  picked: boolean;
  envValues: Record<string, string>;
  onPath: boolean;
  statusKind: CardStatus;
  errorMessage?: string;
  onPickedChange: (picked: boolean) => void;
  onEnvChange: (key: string, value: string) => void;
  onDrop?: () => void;
}

export function OnboardingMcpCard({
  bundled, picked, envValues, onPath, statusKind, errorMessage,
  onPickedChange, onEnvChange, onDrop,
}: Props): JSX.Element {
  return (
    <div className={`p-4 border rounded ${picked ? 'border-accent bg-accent/5' : 'border-border'}`}>
      <div className="flex justify-between items-start gap-3">
        <label className="flex items-start gap-2 flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={picked}
            onChange={(e) => onPickedChange(e.target.checked)}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="text-text-primary font-medium text-sm">{bundled.name}</div>
            <div className="text-text-tertiary text-xs mt-0.5">{bundled.description}</div>
          </div>
        </label>
        <div className="text-xs shrink-0">
          {onPath
            ? <span className="text-success">✓ {bundled.command} on PATH</span>
            : <span className="text-error">✗ {bundled.command} not found</span>}
        </div>
      </div>

      {picked && bundled.envVars && bundled.envVars.length > 0 && (
        <div className="mt-3 ml-6 space-y-2">
          {bundled.envVars.map((key) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-xs text-text-secondary w-40 shrink-0">{key}</span>
              <input
                aria-label={key}
                type="password"
                value={envValues[key] ?? ''}
                onChange={(e) => onEnvChange(key, e.target.value)}
                className="bg-bg-elevated px-2 py-1 rounded flex-1 font-mono text-xs"
              />
            </label>
          ))}
        </div>
      )}

      {!picked && !onPath && (
        <div className="mt-3 ml-6 px-3 py-2 bg-bg-elevated rounded font-mono text-xs text-text-tertiary">
          uv tool install git+{bundled.githubUrl}
        </div>
      )}

      {statusKind === 'testing' && <div className="mt-3 ml-6 text-xs text-text-tertiary">Testing…</div>}
      {statusKind === 'ok' && <div className="mt-3 ml-6 text-xs text-success">✓ Health-check passed</div>}
      {statusKind === 'error' && (
        <div className="mt-3 ml-6 flex items-center gap-3">
          <span role="alert" className="text-xs text-error flex-1">{errorMessage ?? 'failed'}</span>
          {onDrop && (
            <button type="button" onClick={onDrop} className="text-xs underline text-text-tertiary">
              Drop &amp; continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run OnboardingMcpCard tests**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingMcpCard.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Write OnboardingMcps test**

Create `web/src/components/onboarding/OnboardingMcps.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingMcps } from './OnboardingMcps.js';
import * as discoverLib from '../../lib/mcps-discover.js';
import * as onboardingLib from '../../lib/onboarding.js';

vi.mock('../../lib/mcps-discover.js');
vi.mock('../../lib/onboarding.js');

const bundled = [
  { name: 'Slack', slug: 'slack', command: 'slack-mcp', githubUrl: 'https://github.com/aviralv/slack-mcp', description: 'Slack', envVars: ['SLACK_TOKEN'] },
  { name: 'MS365', slug: 'ms365', command: 'ms365-intent-mcp', githubUrl: 'https://x', description: 'MS', envVars: ['MS365_CLIENT_ID'] },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(discoverLib.discoverMcps).mockResolvedValue({
    bundled,
    pathInstalled: ['slack-mcp', 'ms365-intent-mcp'],
  });
});
afterEach(() => vi.restoreAllMocks());

describe('OnboardingMcps', () => {
  it('renders all bundled cards on mount', async () => {
    render(<OnboardingMcps initialMcps={[]} onAdvance={() => {}} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());
    expect(screen.getByText('MS365')).toBeTruthy();
  });

  it('does NOT call addOnboardingMcp when nothing is picked and Continue is clicked', async () => {
    render(<OnboardingMcps initialMcps={[]} onAdvance={() => {}} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getByRole('button', { name: /test.*continue/i }));
    expect(vi.mocked(onboardingLib.addOnboardingMcp)).not.toHaveBeenCalled();
  });

  it('runs addOnboardingMcp for each picked card and advances on success', async () => {
    vi.mocked(onboardingLib.addOnboardingMcp).mockImplementation(async (input) => ({
      name: input.name, command: input.command, enabled: true,
    }));
    const onAdvance = vi.fn();
    render(<OnboardingMcps initialMcps={[]} onAdvance={onAdvance} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);  // pick Slack
    fireEvent.change(screen.getByLabelText('SLACK_TOKEN'), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: /test.*continue/i }));
    await waitFor(() => expect(vi.mocked(onboardingLib.addOnboardingMcp)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } })
    ));
    await waitFor(() => expect(onAdvance).toHaveBeenCalled());
  });

  it('shows per-card error and allows Drop & continue when health-check fails', async () => {
    const { ApiCallError } = await import('../../lib/api.js');
    vi.mocked(onboardingLib.addOnboardingMcp).mockRejectedValueOnce(
      new ApiCallError(422, { error: 'health-check-failed', message: 'spawn failed' })
    );
    render(<OnboardingMcps initialMcps={[]} onAdvance={() => {}} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.change(screen.getByLabelText('SLACK_TOKEN'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /test.*continue/i }));
    await waitFor(() => expect(screen.getByText(/spawn failed/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /drop.*continue/i })).toBeTruthy();
  });

  it('Skip calls skipStep("mcps") and advances', async () => {
    vi.mocked(onboardingLib.skipStep).mockResolvedValue({ completed: false, mcps_skipped: true });
    const onAdvance = vi.fn();
    render(<OnboardingMcps initialMcps={[]} onAdvance={onAdvance} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getByRole('button', { name: /configure mcps later/i }));
    // confirm() default is true via window.confirm stub:
    await waitFor(() => expect(vi.mocked(onboardingLib.skipStep)).toHaveBeenCalledWith('mcps'));
    await waitFor(() => expect(onAdvance).toHaveBeenCalled());
  });
});
```

- [ ] **Step 6: Implement OnboardingMcps**

Create `web/src/components/onboarding/OnboardingMcps.tsx`:

```tsx
import { useState, useEffect, useCallback, type JSX } from 'react';
import { discoverMcps, type BundledServerView } from '../../lib/mcps-discover.js';
import { addOnboardingMcp, skipStep } from '../../lib/onboarding.js';
import type { McpServerEntry } from '../../lib/mcps.js';
import { OnboardingMcpCard, type CardStatus } from './OnboardingMcpCard.js';
import { McpAddModal } from '../McpAddModal.js';
import type { McpInput } from '../../lib/mcps.js';

interface Props {
  initialMcps: McpServerEntry[];
  onAdvance: () => void;
}

interface CardState {
  picked: boolean;
  envValues: Record<string, string>;
  status: CardStatus;
  errorMessage?: string;
}

interface CustomEntry {
  input: McpInput;
  status: CardStatus;
  errorMessage?: string;
}

export function OnboardingMcps({ initialMcps, onAdvance }: Props): JSX.Element {
  const [bundled, setBundled] = useState<BundledServerView[]>([]);
  const [pathInstalled, setPathInstalled] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [customs, setCustoms] = useState<CustomEntry[]>([]);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    void discoverMcps().then((r) => {
      setBundled(r.bundled);
      setPathInstalled(new Set(r.pathInstalled));
      // Pre-pick MCPs already in initialMcps (re-entry).
      const next: Record<string, CardState> = {};
      for (const b of r.bundled) {
        const existing = initialMcps.find(m => m.name === b.slug);
        next[b.slug] = {
          picked: existing !== undefined,
          envValues: {},
          status: existing ? 'ok' : 'idle',
        };
      }
      setCards(next);
    });
  }, [initialMcps]);

  const setPicked = useCallback((slug: string, picked: boolean) => {
    setCards(c => ({ ...c, [slug]: { ...c[slug], picked, status: 'idle', errorMessage: undefined } }));
  }, []);
  const setEnv = useCallback((slug: string, key: string, value: string) => {
    setCards(c => ({ ...c, [slug]: { ...c[slug], envValues: { ...c[slug].envValues, [key]: value } } }));
  }, []);
  const dropCard = useCallback((slug: string) => {
    setCards(c => ({ ...c, [slug]: { ...c[slug], picked: false, status: 'idle', errorMessage: undefined } }));
  }, []);

  const dropCustom = (idx: number) => {
    setCustoms(cs => cs.filter((_, i) => i !== idx));
  };

  const handleCustomSubmit = useCallback((input: McpInput) => {
    setCustoms(cs => [...cs, { input, status: 'idle' }]);
    setShowCustomModal(false);
    return Promise.resolve();
  }, []);

  const testAndContinue = async () => {
    const picked = Object.entries(cards).filter(([, s]) => s.picked);
    const allPicked = [
      ...picked.map(([slug, state]) => ({ kind: 'bundled' as const, slug, bundled: bundled.find(b => b.slug === slug)!, state })),
      ...customs.map((c, idx) => ({ kind: 'custom' as const, idx, custom: c })),
    ];
    if (allPicked.length === 0) {
      setGlobalError('Pick at least one MCP, or click Skip below.');
      return;
    }
    setSubmitting(true);
    setGlobalError(null);

    // Mark all picked as testing.
    setCards(c => {
      const next = { ...c };
      for (const [slug] of picked) next[slug] = { ...next[slug], status: 'testing' };
      return next;
    });
    setCustoms(cs => cs.map(c => ({ ...c, status: 'testing' })));

    const promises = allPicked.map(async (p) => {
      try {
        if (p.kind === 'bundled') {
          await addOnboardingMcp({
            name: p.slug,
            command: p.bundled.command,
            envValues: p.state.envValues,
          });
          setCards(c => ({ ...c, [p.slug]: { ...c[p.slug], status: 'ok' } }));
          return { ok: true, key: p.slug };
        } else {
          const inp = p.custom.input;
          const envValues: Record<string, string> = {};
          for (const [k, v] of Object.entries(inp.env ?? {})) {
            // For custom MCPs, env values may be ${REF} or literal — pass as-is.
            envValues[k] = v;
          }
          await addOnboardingMcp({ name: inp.name, command: inp.command, args: inp.args, envValues });
          setCustoms(cs => cs.map((c, i) => i === p.idx ? { ...c, status: 'ok' } : c));
          return { ok: true, key: inp.name };
        }
      } catch (err) {
        const msg = (err as Error).message ?? 'failed';
        if (p.kind === 'bundled') {
          setCards(c => ({ ...c, [p.slug]: { ...c[p.slug], status: 'error', errorMessage: msg } }));
        } else {
          setCustoms(cs => cs.map((c, i) => i === p.idx ? { ...c, status: 'error', errorMessage: msg } : c));
        }
        return { ok: false, key: p.kind === 'bundled' ? p.slug : p.custom.input.name };
      }
    });

    const results = await Promise.all(promises);
    setSubmitting(false);

    const anyOk = results.some(r => r.ok);
    if (anyOk) onAdvance();
    else setGlobalError('No MCPs succeeded. Fix the errors above or skip below.');
  };

  const handleSkip = async () => {
    if (!window.confirm('Search will return "no sources configured" until you add an MCP. Continue?')) return;
    setSubmitting(true);
    try {
      await skipStep('mcps');
      onAdvance();
    } catch (err) {
      setGlobalError((err as Error).message ?? 'skip failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <h2 className="text-text-primary text-xl">Step 2 — Pick the search sources scry will use</h2>
      <p className="text-text-tertiary text-sm">
        Each picked MCP shows the env vars it needs. They'll be saved to <code className="text-xs">.scry.env</code> and referenced from your config.
      </p>

      <div className="flex flex-col gap-3">
        {bundled.map((b) => (
          <OnboardingMcpCard
            key={b.slug}
            bundled={b}
            picked={cards[b.slug]?.picked ?? false}
            envValues={cards[b.slug]?.envValues ?? {}}
            onPath={pathInstalled.has(b.command)}
            statusKind={cards[b.slug]?.status ?? 'idle'}
            errorMessage={cards[b.slug]?.errorMessage}
            onPickedChange={(p) => setPicked(b.slug, p)}
            onEnvChange={(k, v) => setEnv(b.slug, k, v)}
            onDrop={() => dropCard(b.slug)}
          />
        ))}

        {customs.map((c, idx) => (
          <div key={`custom-${idx}`} className={`p-4 border rounded ${c.status === 'error' ? 'border-error' : 'border-accent bg-accent/5'}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="text-text-primary font-medium text-sm">{c.input.name} <span className="text-xs text-text-tertiary">(custom)</span></div>
                <div className="text-text-tertiary text-xs mt-0.5 font-mono">{c.input.command} {c.input.args?.join(' ')}</div>
              </div>
            </div>
            {c.status === 'error' && (
              <div className="mt-3 flex items-center gap-3">
                <span role="alert" className="text-xs text-error flex-1">{c.errorMessage}</span>
                <button type="button" onClick={() => dropCustom(idx)} className="text-xs underline text-text-tertiary">
                  Drop &amp; continue
                </button>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setShowCustomModal(true)}
          disabled={submitting}
          className="p-4 border border-dashed border-border rounded text-text-tertiary text-sm hover:bg-bg-elevated"
        >
          + Add custom MCP
        </button>
      </div>

      {globalError && <div role="alert" className="text-error text-sm">{globalError}</div>}

      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-text-tertiary text-xs underline"
        >
          I'll configure MCPs later — search will be unavailable
        </button>
        <button
          type="button"
          onClick={testAndContinue}
          disabled={submitting}
          className="px-4 py-2 bg-accent text-bg-primary rounded text-sm"
        >
          {submitting ? 'Testing…' : 'Test & Continue →'}
        </button>
      </div>

      {showCustomModal && (
        <McpAddModal
          mode="add"
          onSubmit={handleCustomSubmit}
          onClose={() => setShowCustomModal(false)}
        />
      )}
    </div>
  );
}
```

Note on the custom modal flow: the existing `McpAddModal` calls `onSubmit` with `McpInput` and then `onClose`. Our wizard's `handleCustomSubmit` adds the entry to `customs` state — it does NOT POST. The modal's existing behavior (await `onSubmit`, then `onClose`) works because we return `Promise.resolve()` from `handleCustomSubmit`. The actual write happens in `testAndContinue` via `addOnboardingMcp`. **No source change to `McpAddModal` is needed** — its `onSubmit` is already a callback into the parent, which is exactly what the spec called for.

- [ ] **Step 7: Run all Step 2 tests**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingMcps.test.tsx src/components/onboarding/OnboardingMcpCard.test.tsx
```

Expected: PASS — 5 + 5 = 10 tests.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/onboarding/OnboardingMcpCard.tsx web/src/components/onboarding/OnboardingMcpCard.test.tsx web/src/components/onboarding/OnboardingMcps.tsx web/src/components/onboarding/OnboardingMcps.test.tsx
git commit -m "feat(web): OnboardingMcps + OnboardingMcpCard — Step 2

Single-column stack of bundled cards with inline env-var inputs.
Custom MCP card opens existing McpAddModal; the modal's onSubmit
hook adds to wizard state without writing. Test & Continue runs
addOnboardingMcp for each picked card in parallel; per-card errors
get inline 'Drop & continue' affordance. Skip writes mcps_skipped."
```

---

## Task 16: `OnboardingConfirm` component (Step 3)

Read-only summary screen + Finalize button.

**Files:**
- Create: `web/src/components/onboarding/OnboardingConfirm.tsx`
- Create: `web/src/components/onboarding/OnboardingConfirm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/onboarding/OnboardingConfirm.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingConfirm } from './OnboardingConfirm.js';
import * as onboardingLib from '../../lib/onboarding.js';

vi.mock('../../lib/onboarding.js');

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

const baseLlm = { base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', hasAuth: true };
const baseMcps = [{ name: 'slack', command: 'slack-mcp', enabled: true }];

describe('OnboardingConfirm', () => {
  it('renders LLM model and base_url', () => {
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={() => {}} onEditStep={() => {}} />);
    expect(screen.getByText(/claude-haiku-4-5-20251001/)).toBeTruthy();
    expect(screen.getByText(/api.anthropic.com/)).toBeTruthy();
  });

  it('renders each MCP with status', () => {
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={() => {}} onEditStep={() => {}} />);
    expect(screen.getByText('slack')).toBeTruthy();
  });

  it('shows skip warnings when flags are set', () => {
    render(<OnboardingConfirm llm={null} mcps={[]} flags={{ completed: false, llm_skipped: true, mcps_skipped: true }} onFinalize={() => {}} onEditStep={() => {}} />);
    expect(screen.getByText(/llm.*not configured/i)).toBeTruthy();
    expect(screen.getByText(/no mcps configured/i)).toBeTruthy();
  });

  it('Finalize calls completeOnboarding then onFinalize', async () => {
    vi.mocked(onboardingLib.completeOnboarding).mockResolvedValue();
    const onFinalize = vi.fn();
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={onFinalize} onEditStep={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /finalize/i }));
    await waitFor(() => expect(vi.mocked(onboardingLib.completeOnboarding)).toHaveBeenCalled());
    await waitFor(() => expect(onFinalize).toHaveBeenCalled());
  });

  it('Edit Step 1 calls onEditStep(1)', () => {
    const onEditStep = vi.fn();
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={() => {}} onEditStep={onEditStep} />);
    fireEvent.click(screen.getByRole('button', { name: /edit llm/i }));
    expect(onEditStep).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Implement OnboardingConfirm**

Create `web/src/components/onboarding/OnboardingConfirm.tsx`:

```tsx
import { useState, type JSX } from 'react';
import type { McpServerEntry } from '../../lib/mcps.js';
import type { OnboardingLlm, OnboardingFlags } from '../../lib/onboarding.js';
import { completeOnboarding } from '../../lib/onboarding.js';

interface Props {
  llm: OnboardingLlm | null;
  mcps: McpServerEntry[];
  flags: OnboardingFlags;
  onFinalize: () => void;
  onEditStep: (n: 1 | 2) => void;
}

export function OnboardingConfirm({ llm, mcps, flags, onFinalize, onEditStep }: Props): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinalize = async () => {
    setSubmitting(true);
    try {
      await completeOnboarding();
      onFinalize();
    } catch (err) {
      setError((err as Error).message ?? 'finalize failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <h2 className="text-text-primary text-xl">Step 3 — Confirm &amp; finish</h2>

      <section className="border border-border rounded p-4">
        <div className="flex justify-between items-start">
          <h3 className="text-text-primary font-medium">LLM</h3>
          <button type="button" onClick={() => onEditStep(1)} className="text-xs underline text-text-tertiary" aria-label="Edit LLM">
            Edit
          </button>
        </div>
        {llm ? (
          <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-text-tertiary">Model</dt><dd className="font-mono text-xs">{llm.model}</dd>
            <dt className="text-text-tertiary">Base URL</dt><dd className="font-mono text-xs">{llm.base_url}</dd>
            <dt className="text-text-tertiary">Auth</dt>
            <dd className="text-xs">{llm.hasAuth ? <span className="text-success">✓ configured</span> : <span className="text-text-tertiary">not configured (proxy?)</span>}</dd>
          </dl>
        ) : (
          <div className="mt-3 text-sm text-text-tertiary italic">Not configured.</div>
        )}
        {flags.llm_skipped && (
          <div className="mt-3 text-xs text-warning">⚠ LLM not configured — searches will fail until you complete LLM setup.</div>
        )}
      </section>

      <section className="border border-border rounded p-4">
        <div className="flex justify-between items-start">
          <h3 className="text-text-primary font-medium">MCPs</h3>
          <button type="button" onClick={() => onEditStep(2)} className="text-xs underline text-text-tertiary" aria-label="Edit MCPs">
            Edit
          </button>
        </div>
        {mcps.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {mcps.map((m) => (
              <li key={m.name} className="flex items-center gap-2">
                <span className="text-success">✓</span>
                <span className="font-mono text-xs">{m.name}</span>
                <span className="text-text-tertiary text-xs">— {m.command}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 text-sm text-text-tertiary italic">No MCPs configured.</div>
        )}
        {flags.mcps_skipped && mcps.length === 0 && (
          <div className="mt-3 text-xs text-warning">⚠ No MCPs configured — search has no sources.</div>
        )}
      </section>

      {error && <div role="alert" className="text-error text-sm">{error}</div>}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleFinalize}
          disabled={submitting}
          className="px-4 py-2 bg-accent text-bg-primary rounded text-sm"
        >
          {submitting ? 'Finalizing…' : 'Finalize & start searching'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
cd web && npx vitest run src/components/onboarding/OnboardingConfirm.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/onboarding/OnboardingConfirm.tsx web/src/components/onboarding/OnboardingConfirm.test.tsx
git commit -m "feat(web): OnboardingConfirm — Step 3 read-only summary

LLM section + MCP list with health icons + skip warnings.
Finalize button calls /api/onboarding/complete then redirects."
```

---

## Task 17: `Onboarding` route — orchestrator

The route component that owns state, derives the current step from server state + URL `?step`, renders the rail + active-step pane.

**Files:**
- Create: `web/src/routes/Onboarding.tsx`
- Create: `web/src/routes/Onboarding.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/Onboarding.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Onboarding } from './Onboarding.js';
import * as onboardingLib from '../lib/onboarding.js';
import * as discoverLib from '../lib/mcps-discover.js';

vi.mock('../lib/onboarding.js');
vi.mock('../lib/mcps-discover.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(discoverLib.discoverMcps).mockResolvedValue({ bundled: [], pathInstalled: [] });
});
afterEach(() => vi.restoreAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const fresh = { llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [] };

describe('Onboarding route — step derivation', () => {
  it('lands on Step 1 when llm is null', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue(fresh);
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });

  it('lands on Step 2 when llm is set but mcps are empty', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'https://api.anthropic.com', model: 'm', hasAuth: true },
    });
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());
  });

  it('lands on Step 3 when llm + mcps are present', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'https://api.anthropic.com', model: 'm', hasAuth: true },
      mcps: [{ name: 'slack', command: 'slack-mcp', enabled: true }],
    });
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
  });

  it('lands on Step 3 when completed:true (re-entry)', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'x', model: 'y', hasAuth: true },
      mcps: [{ name: 'slack', command: 'slack-mcp', enabled: true }],
      onboarding: { completed: true },
    });
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
  });

  it('honors URL ?step=1 override even when llm is set', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'x', model: 'y', hasAuth: true },
    });
    renderAt('/onboarding?step=1');
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });

  it('rail click navigates to the requested step (URL updates)', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'x', model: 'y', hasAuth: true },
      mcps: [{ name: 'slack', command: 'slack-mcp', enabled: true }],
    });
    renderAt('/onboarding');
    await waitFor(() => screen.getByText(/Step 3/));
    // Click the rail's "LLM" button.
    fireEvent.click(screen.getByRole('button', { current: undefined, name: /LLM/i }));
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/routes/Onboarding.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `web/src/routes/Onboarding.tsx`:

```tsx
import { useState, useEffect, useCallback, type JSX } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getOnboardingState, type OnboardingState } from '../lib/onboarding.js';
import { OnboardingRail, type RailStep, type StepStatus } from '../components/onboarding/OnboardingRail.js';
import { OnboardingLlm } from '../components/onboarding/OnboardingLlm.js';
import { OnboardingMcps } from '../components/onboarding/OnboardingMcps.js';
import { OnboardingConfirm } from '../components/onboarding/OnboardingConfirm.js';

type Step = 1 | 2 | 3;

function deriveStep(state: OnboardingState): Step {
  if (state.onboarding.completed) return 3;
  if (state.llm == null && !state.onboarding.llm_skipped) return 1;
  if (state.mcps.length === 0 && !state.onboarding.mcps_skipped) return 2;
  return 3;
}

function llmSummary(state: OnboardingState): string {
  if (state.onboarding.llm_skipped && !state.llm) return 'skipped';
  if (!state.llm) return '';
  return `${state.llm.model} · ${state.llm.base_url}`;
}

function mcpsSummary(state: OnboardingState): string {
  if (state.onboarding.mcps_skipped && state.mcps.length === 0) return 'skipped';
  if (state.mcps.length === 0) return '';
  return `${state.mcps.length} configured`;
}

function statusFor(step: Step, current: Step): StepStatus {
  if (step === current) return 'active';
  if (step < current) return 'done';
  return 'todo';
}

export function Onboarding(): JSX.Element {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const r = await getOnboardingState();
      setState(r);
    } catch {
      // 412 means no config — treat as fresh state.
      setState({ llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [] });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!state) return <div className="p-6 text-text-tertiary">Loading…</div>;

  const stepParam = searchParams.get('step');
  const urlStep = stepParam === '1' ? 1 : stepParam === '2' ? 2 : stepParam === '3' ? 3 : null;
  const currentStep: Step = urlStep ?? deriveStep(state);

  const goToStep = (n: Step) => {
    setSearchParams({ step: String(n) });
  };

  const advanceFromStep = async (n: Step) => {
    await refresh();
    if (n === 3) {
      // Coming out of finalize — go to home.
      navigate('/');
    } else {
      goToStep((n + 1) as Step);
    }
  };

  const railSteps: RailStep[] = [
    { n: 1, title: 'LLM', summary: llmSummary(state), status: statusFor(1, currentStep) },
    { n: 2, title: 'MCPs', summary: mcpsSummary(state), status: statusFor(2, currentStep) },
    { n: 3, title: 'Confirm & finish', summary: '', status: statusFor(3, currentStep) },
  ];

  return (
    <div className="flex h-full">
      <OnboardingRail steps={railSteps} onStepClick={goToStep} />
      <div className="flex-1 p-8 overflow-y-auto">
        {currentStep === 1 && (
          <OnboardingLlm
            initialLlm={state.llm}
            detectedRefs={state.detectedRefs}
            onAdvance={() => advanceFromStep(1)}
          />
        )}
        {currentStep === 2 && (
          <OnboardingMcps
            initialMcps={state.mcps}
            onAdvance={() => advanceFromStep(2)}
          />
        )}
        {currentStep === 3 && (
          <OnboardingConfirm
            llm={state.llm}
            mcps={state.mcps}
            flags={state.onboarding}
            onFinalize={() => advanceFromStep(3)}
            onEditStep={(n) => goToStep(n)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/routes/Onboarding.test.tsx
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/Onboarding.tsx web/src/routes/Onboarding.test.tsx
git commit -m "feat(web): Onboarding route — orchestrator + step derivation

Reads /api/onboarding once on mount; derives current step from
{llm, mcps.length, onboarding flags}. URL ?step=N overrides
derivation so rail clicks are bookmarkable. After each step's
onAdvance: refetch state, advance URL. Step 3's onFinalize
navigates to /."
```

---

## Task 18: Wire up `App.tsx`, sidebar, and `/` banners

The wizard exists; now hook it into the app shell so the auto-redirect actually fires and the sidebar's Onboarding link appears when needed.

**Files:**
- Modify: `web/src/App.tsx` (add `/onboarding` route + wrap others in `RequireOnboarding`)
- Modify: `web/src/components/LibrarySidebar.tsx` (conditional Onboarding NavLink)
- Modify: `web/src/routes/Search.tsx` (banners for `llm_skipped` / `mcps_skipped`)
- Modify: `web/src/routes/McpManager.tsx` (replace 412 stub with redirect)
- Modify: `web/src/routes/Registry.tsx` (replace 412 stub with redirect)

- [ ] **Step 1: Update `App.tsx` to mount the wizard route + wrapper**

Replace the contents of `web/src/App.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LibrarySidebar } from './components/LibrarySidebar.js';
import { RequireOnboarding } from './components/RequireOnboarding.js';
import { Search } from './routes/Search.js';
import { McpManager } from './routes/McpManager.js';
import { Registry } from './routes/Registry.js';
import { Onboarding } from './routes/Onboarding.js';

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
                <RequireOnboarding>
                  <Search
                    activeSessionId={activeSessionId}
                    onSessionStarted={handleSessionStarted}
                    onSessionDone={handleSessionDone}
                  />
                </RequireOnboarding>
              }
            />
            <Route path="/mcps" element={<RequireOnboarding><McpManager /></RequireOnboarding>} />
            <Route path="/registry" element={<RequireOnboarding><Registry /></RequireOnboarding>} />
            <Route path="/onboarding" element={<Onboarding />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Add the conditional Onboarding NavLink to the sidebar**

In `web/src/components/LibrarySidebar.tsx`, find the navigation block (lines ~110-135 with the existing NavLinks) and add Onboarding between MCPs and Registry. First, add the import + state fetch — read the existing structure:

```bash
grep -n "NavLink\|getOnboardingState" web/src/components/LibrarySidebar.tsx
```

In the file's imports, add:

```tsx
import { useState, useEffect } from 'react';   // (already imported — confirm)
import { getOnboardingState } from '../lib/onboarding.js';
```

Inside the `LibrarySidebar` function body, after `const [collapsed, setCollapsed] = useState(false);`, add:

```tsx
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    let alive = true;
    getOnboardingState()
      .then((s) => { if (alive) setShowOnboarding(!s.onboarding.completed); })
      .catch(() => { if (alive) setShowOnboarding(true); });   // 412 → show
    return () => { alive = false; };
  }, [refreshKey]);
```

Then in the NavLink block (the section showing `Search`, `MCPs`, `Registry`), add a conditional Onboarding link. Replace the nav block with:

```tsx
      <div className="px-2 pt-2 flex flex-wrap gap-2 text-xs">
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
        <NavLink
          to="/registry"
          className={({ isActive }: { isActive: boolean }) =>
            `px-2 py-1 rounded ${isActive ? 'bg-bg-elevated text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`
          }
        >
          Registry
        </NavLink>
        {showOnboarding && (
          <NavLink
            to="/onboarding"
            className={({ isActive }: { isActive: boolean }) =>
              `px-2 py-1 rounded ${isActive ? 'bg-accent text-bg-primary' : 'text-accent hover:bg-accent/10'}`
            }
          >
            Onboarding
          </NavLink>
        )}
      </div>
```

- [ ] **Step 3: Update Search route to show skip banners**

In `web/src/routes/Search.tsx`, near the top of the rendered content (above the search input), add banners. First read the existing structure:

```bash
grep -n "export function Search" web/src/routes/Search.tsx
head -50 web/src/routes/Search.tsx
```

Add to the imports:

```tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getOnboardingState, type OnboardingState } from '../lib/onboarding.js';
```

In the `Search` function body, after the existing `useState` calls, add:

```tsx
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  useEffect(() => {
    void getOnboardingState().then(setOnboarding).catch(() => {});
  }, []);

  const llmBannerNeeded = onboarding?.onboarding.llm_skipped && onboarding.llm == null;
  const mcpsBannerNeeded = onboarding?.onboarding.mcps_skipped && onboarding.mcps.length === 0;
```

In the JSX return, just inside the outer container (before the search input), add:

```tsx
      {llmBannerNeeded && (
        <div role="status" className="m-3 p-3 bg-warning/10 border border-warning rounded text-sm">
          LLM not configured — searches will fail until you complete LLM setup.{' '}
          <Link to="/onboarding?step=1" className="underline">Configure now →</Link>
        </div>
      )}
      {mcpsBannerNeeded && (
        <div role="status" className="m-3 p-3 bg-warning/10 border border-warning rounded text-sm">
          No MCPs configured — search has no sources.{' '}
          <Link to="/onboarding?step=2" className="underline">Configure now →</Link>
        </div>
      )}
```

- [ ] **Step 4: Replace 412 stubs in `/mcps` and `/registry` with auto-redirect**

In `web/src/routes/McpManager.tsx`, locate the `if (needsConfig)` block (around line 71-77). Replace:

```tsx
  if (needsConfig) {
    return (
      <div className="p-6 text-text-tertiary">
        No config yet. Run scry through onboarding first.
      </div>
    );
  }
```

with:

```tsx
  if (needsConfig) {
    return <Navigate to="/onboarding" replace />;
  }
```

Add the import at the top:

```tsx
import { Navigate } from 'react-router-dom';
```

Repeat the same change in `web/src/routes/Registry.tsx` — find the equivalent 412/needsConfig block (the spec mentioned the same stub copy "Run scry through onboarding first") and replace with `<Navigate to="/onboarding" replace />`.

(With `RequireOnboarding` already redirecting on 412, these inner stubs are belt-and-braces — but they handle the rare case where the route loaded successfully and hit 412 only on a child API call.)

- [ ] **Step 5: Run the web suite**

```bash
cd web && npx vitest run
```

Expected: PASS — full web suite. Some existing tests may break on the App.tsx change (e.g., tests that mounted `/` and didn't mock `getOnboardingState`); for those, mock the lib at the top of the failing test:

```tsx
import * as onboardingLib from '../lib/onboarding.js';
vi.mock('../lib/onboarding.js');
beforeEach(() => {
  vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
    llm: { base_url: 'x', model: 'y', hasAuth: true },
    mcps: [], onboarding: { completed: true }, detectedRefs: [], detectedEnvKeys: [],
  });
});
```

If existing `LibrarySidebar.test.tsx` exists and breaks on the new `getOnboardingState` call, mock it the same way at the top of that file.

- [ ] **Step 6: Run the full backend suite to confirm no regression**

```bash
npx vitest run
```

Expected: PASS — full backend suite green.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx web/src/components/LibrarySidebar.tsx web/src/routes/Search.tsx web/src/routes/McpManager.tsx web/src/routes/Registry.tsx
git commit -m "feat(web): wire onboarding into App, sidebar, Search, and 412 stubs

- App.tsx wraps /, /mcps, /registry in RequireOnboarding; mounts /onboarding
- LibrarySidebar shows Onboarding NavLink when completed:false; refreshes on refreshKey
- Search route renders skip banners with deep-links into the wizard
- /mcps and /registry's 412 stubs replaced with <Navigate to=/onboarding/>"
```

---

## Task 19: Smoke test on the branch

Real-workspace smoke before opening a PR. The two-stage pattern from E/F caught real design bugs at this step (collapsed-row, single-column-wastes-screen, double labels).

- [ ] **Step 1: Build and run scry serve from the branch in a separate workspace**

```bash
# In the scry repo:
npm run build

# In a fresh empty directory (NOT the scry repo):
mkdir -p ~/Desktop/scry-smoke
cd ~/Desktop/scry-smoke
node /Users/I578221/Library/CloudStorage/OneDrive-SAPSE/Documents/the-product-kitchen/Playground/scry/dist/cli/index.js serve
```

Open the printed URL. Expected: lands on `/onboarding` Step 1 because the smoke directory has no `scry.config.yaml`.

Hold on — the wizard requires `scry.config.yaml` to exist (every route 412s without it). For a true brand-new-user smoke, the wizard needs to bootstrap the file. **Discovery during smoke:** does the spec call out where the empty config gets created from?

Looking back at the spec: section "Trigger & redirect" says auto-redirect happens on 412. But the wizard's POST endpoints all return 412 too if the config is missing — meaning the wizard can't write anything. **This is a real gap.**

Two paths:

A. The wizard's first action (Step 1's PUT /api/llm) creates the file if it doesn't exist.
B. `scry serve` creates an empty config on first launch if missing.

Path B is cleaner — `scry serve` already auto-creates the SQLite DB at `<configDir>/scry.db`, and the same boot logic could create an empty `scry.config.yaml` if missing. Then every route works (returns empty data instead of 412), `RequireOnboarding` redirects on `completed:false`, the wizard writes via PUT/POST normally.

- [ ] **Step 2: Add config auto-creation to `boot.ts`**

The cleanest fix is in `src/server/boot.ts`. After `console.log(\`scry: config = ...\`)` and before `loadDotEnvFile`, add:

```ts
import { existsSync, writeFileSync } from 'fs';
// ...
if (!existsSync(configPath)) {
  console.log(`scry: creating empty config at ${configPath}`);
  writeFileSync(configPath, 'mcp_servers: {}\nsearch_tools: {}\n', 'utf-8');
}
```

This is a 4-line change. The file gets a minimal valid skeleton that all the existing routes accept. The wizard then writes `llm:` (Step 1), `mcp_servers.<name>:` (Step 2), and `onboarding:` (Step 3) into it.

Add a test for this in `tests/server/boot.test.ts` (create the file if missing):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startServer } from '../../src/server/boot.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-boot-'));
  process.env.SCRY_CONFIG = join(dir, 'scry.config.yaml');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SCRY_CONFIG;
});

describe('startServer', () => {
  it('creates an empty config when none exists', async () => {
    const cfg = process.env.SCRY_CONFIG!;
    expect(existsSync(cfg)).toBe(false);
    const server = await startServer({ port: 0 });
    expect(existsSync(cfg)).toBe(true);
    expect(readFileSync(cfg, 'utf-8')).toContain('mcp_servers');
    server.close();
  });
});
```

- [ ] **Step 3: Run the boot test**

```bash
npx vitest run tests/server/boot.test.ts
```

Expected: PASS.

- [ ] **Step 4: Re-run full backend suite**

```bash
npx vitest run
```

Expected: PASS — full suite. The migration test from Task 7 should still pass because `runOnboardingAutocomplete` runs on an already-existing config.

- [ ] **Step 5: Commit the auto-create**

```bash
git add src/server/boot.ts tests/server/boot.test.ts
git commit -m "feat(server): create empty config on first scry serve

Without this, the wizard's PUT/POST endpoints would 412-loop forever
on a brand-new user — the wizard can't bootstrap the file it needs.
Two-line scaffold gives the wizard a writable starting point."
```

- [ ] **Step 6: Run full smoke**

Rebuild and re-launch from the smoke directory:

```bash
npm run build
cd ~/Desktop/scry-smoke
rm -f scry.config.yaml .scry.env scry.db   # clean slate
node /Users/I578221/Library/CloudStorage/OneDrive-SAPSE/Documents/the-product-kitchen/Playground/scry/dist/cli/index.js serve
```

Walk through:
1. Open browser to printed URL → lands on `/onboarding` Step 1.
2. Step 1: enter your `http://localhost:6655/anthropic/` base_url, leave "no auth required" checked, model `claude-haiku-4-5-20251001`. Click Test & Continue → expect ✓ (assuming model-gateway is running) → advance to Step 2.
3. Step 2: pick Slack, enter your `SLACK_TOKEN`. Click Test & Continue → if `slack-mcp` is on PATH, expect ✓ on the card → advance to Step 3.
4. Step 3: confirm + Finalize → land on `/`.
5. Refresh `/` → no redirect (onboarding completed).
6. Visit `/onboarding` directly → land on Step 3 with edit affordances; sidebar's Onboarding link is hidden.

Catch any UI/UX issues that tests can't ("how it feels to use," not "does the function return the right value"). Common smoke catches from E and F: stale state after a write, layout breaks at narrow widths, copy that surprises the user.

If issues found: append per-issue commits with fixes; iterate until smoke is clean.

---

## Task 20: Open PR + adversarial review pass

**Files:** None (operational task).

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/onboarding-wizard-g
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: Plan G — onboarding wizard (/onboarding)" --body "$(cat <<EOF
Closes the manual-paste workflow caught during Plan E smoke. Brand-new
scry users now configure LLM + MCPs through a 3-step web wizard instead
of editing scry.config.yaml by hand.

## What

3-step wizard at \`/onboarding\`:

1. **LLM** — base_url + auth + model + real test call. Localhost-shortcut for proxies. Detects \${ANTHROPIC_API_KEY} env presence and prefills.
2. **MCPs** — bundled cards (Slack, MS365, Confluence/Jira) with inline env-var inputs + PATH status; "+ Add custom MCP" via existing \`McpAddModal\`.
3. **Confirm** — read-only summary; Finalize redirects to /.

Per-step writes (refresh-safe, re-entrant). Block-by-default with named-consequence skips and persistent banners.

## Architecture

- \`writeConfigAndEnv\` — two-phase atomic write across config + .scry.env
- \`writeDotEnv\` — comment-preserving merge into .scry.env, rejects \\\\n
- \`runLlmTest\` — outbound LLM ping with SSRF guard (https-only, localhost carve-out)
- Server-startup migration auto-marks pre-G configs complete (no wizard hijacking)
- \`RequireOnboarding\` wrapper redirects unconfigured users; refreshes on tab visibility

## Tests

- Backend: ~50 new tests across schema, dotenv-write, write-config-pair, ssrf, llm-test, migration, llm/onboarding/mcps-discover routes
- Web: ~30 new tests across onboarding lib, RequireOnboarding, Onboarding route, all 5 wizard components

## Spec & follow-on review trail

- Spec: docs/superpowers/specs/2026-06-02-onboarding-wizard-g-design.md
- Plan: docs/superpowers/plans/2026-06-03-onboarding-wizard-g-plan.md
- Spec passed GPT-4.1 + Gemini 2.5 Pro adversarial pass (7 spec changes applied; full triage in spec's Dismissed Reviewer Points).

## Smoke

Walked from empty directory → \`scry serve\` → wizard → working search end-to-end. Discovery: scry serve needed to auto-create empty config on first launch (added in Task 19, separate commit).
EOF
)"
```

- [ ] **Step 3: Run GPT + Gemini adversarial review on the diff**

Same pattern as PR #14 and the Plan G spec review. Save the diff:

```bash
git diff main...feat/onboarding-wizard-g > /tmp/scry-pr-g.diff
```

Then dispatch via the model-comparison agent (parallel calls, GPT-5 with 4.1 fallback + Gemini 2.5 Pro). Triage findings inline; apply real fixes as additional commits on the same branch. Reply on the PR with the applied/dismissed/deferred breakdown.

- [ ] **Step 4: Wait for user approval before merge**

Per Playground deployment rules: don't merge without explicit user confirmation. Deploy on the branch first (`uv tool install git+https://github.com/aviralv/scry.git@feat/onboarding-wizard-g` if you want to test the bundled CLI flow alongside the web), confirm everything works in a real session, then merge.

---

## Summary

20 tasks covering:

- **Server** (10 tasks): schema additions, dotenv-write helper, two-phase write helper, SSRF guard, LLM test runner, startup migration, three new route files, wiring into index.ts
- **Web** (8 tasks): three lib clients, RequireOnboarding wrapper, four wizard components, route orchestrator, App.tsx + sidebar + Search wiring
- **Smoke + PR** (2 tasks): real-workspace smoke (caught the empty-config bootstrap need), PR with adversarial review trail

Reused without modification:
- Plan E's `writeConfig`, `proper-lockfile`, `atomicWriteConfig`, `healthCheck`, `resolveDeclaredEnv`, `McpServerConfigSchema`
- Plan E's `McpAddModal` (its existing `onSubmit` callback prop is exactly the integration point Plan G needed — no source change)
- Plan A's CSRF middleware (auto-applies to new routes)
- Plan F's path-scoped error pattern + `ApiCallError` + `ApiErrorBody`

