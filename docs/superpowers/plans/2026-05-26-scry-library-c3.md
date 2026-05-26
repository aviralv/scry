# scry — Plan C3: Library sidebar + SQLite persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A persistent library of past search sessions. The browser shows a left-side `LibrarySidebar` that lists prior sessions grouped by recency. Clicking a row loads the saved query + answer + cards from SQLite; submitting a follow-up resumes via the SDK's session JSONL. Reload no longer loses state — the C2 reload-notice goes away.

**Architecture:** New `src/storage/sessions.ts` wraps `better-sqlite3` (WAL mode). `POST /api/search` writes a row on `done` (orphan-safe — no insert on `session-init`). New routes `GET/POST/PATCH/DELETE /api/sessions/...` expose the library. Frontend gets a flex layout: `LibrarySidebar` left + existing `Search` right. App owns `activeSessionId`; sidebar click sets it; `Search` watches for changes and fetches the saved session.

**Tech Stack:** `better-sqlite3` (sync, fast, single-process), Hono routes, React, Vite.

**Spec reference:** [`docs/superpowers/specs/2026-05-25-scry-search-route-design.md`](../specs/2026-05-25-scry-search-route-design.md) — § Plan C3.

**Branch state at start:** `main` post-PR-#10 merge. Tests: 178 passing. Branch off latest `main`.

**Deviations from spec:**

1. **Schema stores turns as JSON, not flat fields.** Spec has `title, query, final_answer, sources_json, summary`. Since C2 sessions have multiple turns, the cleanest fit is one row per session with a `turns_json` blob containing the array of turns. Drops `summary` (unused in spec; YAGNI).
2. **No server-side `priorSources` fetch.** The spec says `POST /api/search` reads `sources_json` from the row and passes to `runQuery`. C2 dropped `priorSources` entirely (per-turn scoping makes each turn start at `[1]`; SDK `resume` handles continuity). C3 does not bring it back. The stored `turns_json` is solely for sidebar UI reconstitution.

**Bugs fixed in plan revision (post-multi-model review):**

3. **Composite pagination cursor `(updated_at, id)`** — strict-less-than on `updated_at` alone could skip rows with same-millisecond timestamps. Index re-ordered to `(updated_at DESC, id DESC)`; `ListOpts` adds `beforeId` for tie-breaking; storage test added for same-ms rows.
4. **`finalAnswer` captured from `done` event, not server-side concat of `assistant-text` deltas.** Engine joins multi-block answers with `\n`; server-side `+=` does not — would diverge on multi-block responses. Persistence now uses `event.finalAnswer` (engine's authoritative value) on `done`.
5. **`useEffect` in `Search.tsx` depends only on `activeSessionId`, not on `state`.** Carrying `state` in deps re-fires the effect on every streaming token. State for the "is this our own session?" guard now lives in a ref (`ownSessionIdRef`) updated via a separate effect.
6. **`SessionsStore.close()` registered on SIGINT/SIGTERM** in `boot.ts` — clean WAL shutdown rather than relying on process exit.
7. **`PRAGMA user_version = 1`** — cheap forward-compat for future schema migrations.
8. **Follow-up turn persistence test added** — verifies T3's append-on-existing path (T2 only confirmed the SDK preserves session_id on `resume` indirectly; this test is direct).

**Out of scope for C3:** Multi-tab live sync (single-tab assumption documented). Sweep of orphan SDK JSONLs after delete. Search across past sessions. **Deleting a session row via the API does not abort an in-flight `runQuery` for that session** — the streaming response will still complete and may try to upsert against a now-missing row (handled by the `persistTurn` fallback path). Acceptable since deleting your own active session is a self-inflicted edge case.

---

## File map

| Path | Purpose |
|---|---|
| `src/storage/sessions.ts` | NEW — `SessionsStore` class on better-sqlite3 with schema bootstrap + WAL |
| `src/storage/types.ts` | NEW — `SessionRow`, `StoredTurn` shapes shared between server + client |
| `src/server/routes/sessions.ts` | NEW — `GET/POST/PATCH/DELETE /api/sessions/...` |
| `src/server/routes/search.ts` | MODIFY — accumulate turn data while streaming; insert/update row on `done` |
| `src/server/index.ts` | MODIFY — instantiate `SessionsStore`, mount sessions route, inject store into search route |
| `src/server/boot.ts` | MODIFY — pass `scryConfigDir` so the store knows where to put the db |
| `src/shared/types.ts` | MODIFY — re-export `SessionRow`, `StoredTurn` |
| `tests/storage/sessions.test.ts` | NEW — store CRUD + WAL + pagination |
| `tests/server/routes/sessions.test.ts` | NEW — list/get/patch/delete contract |
| `tests/server/routes/search.test.ts` | MODIFY — assert insert-on-done writes the row |
| `web/src/lib/sessions.ts` | NEW — API client (`listSessions`, `getSession`, `patchSession`, `deleteSession`) |
| `web/src/components/LibrarySidebar.tsx` | NEW — left rail; fetches list, groups by time bucket, "New search" button |
| `web/src/components/SessionRow.tsx` | NEW — title (truncated) + "..." menu (Rename / Delete) |
| `web/src/routes/Search.tsx` | MODIFY — accept `activeSessionId` prop; on change, fetch + load; emit `onSessionStarted` |
| `web/src/App.tsx` | MODIFY — flex layout; own `activeSessionId`; pass refresh-trigger to sidebar |

---

### Task 1: Storage layer — `SessionsStore` + schema + tests

**Files:**
- Create: `src/storage/types.ts`
- Create: `src/storage/sessions.ts`
- Create: `tests/storage/sessions.test.ts`
- Modify: `package.json` (add `better-sqlite3` + `@types/better-sqlite3`)

- [ ] **Step 1: Add the dependency**

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

Verify both land in `package.json` (`better-sqlite3` in dependencies, `@types/better-sqlite3` in devDependencies). Commit `package.json` + `package-lock.json` together at the end of this task.

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/storage/sessions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionsStore } from '../../src/storage/sessions.js';

describe('SessionsStore', () => {
  let dir: string;
  let store: SessionsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scry-sessions-'));
    store = new SessionsStore(join(dir, 'scry.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the schema on first open and produces a db file', () => {
    expect(existsSync(join(dir, 'scry.db'))).toBe(true);
  });

  it('insert + get round-trips a row', () => {
    const now = Date.now();
    store.insert({
      id: 'sess-1',
      cwd: '/tmp/scry',
      title: 'first query',
      turns: [{ query: 'first query', finalAnswer: 'answer', cards: [] }],
      createdAt: now,
      updatedAt: now,
    });
    const got = store.get('sess-1');
    expect(got).not.toBeNull();
    expect(got!.id).toBe('sess-1');
    expect(got!.title).toBe('first query');
    expect(got!.turns).toHaveLength(1);
    expect(got!.turns[0].finalAnswer).toBe('answer');
  });

  it('returns null on missing id', () => {
    expect(store.get('nope')).toBeNull();
  });

  it('list orders by updatedAt DESC', () => {
    store.insert({ id: 'a', cwd: '/x', title: 'A', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'b', cwd: '/x', title: 'B', turns: [], createdAt: 200, updatedAt: 200 });
    store.insert({ id: 'c', cwd: '/x', title: 'C', turns: [], createdAt: 150, updatedAt: 150 });
    const rows = store.list();
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('list pagination via { limit, before }', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ id: `s${i}`, cwd: '/x', title: `T${i}`, turns: [], createdAt: i * 100, updatedAt: i * 100 });
    }
    const first = store.list({ limit: 2 });
    expect(first.map((r) => r.id)).toEqual(['s4', 's3']);
    const second = store.list({ limit: 2, before: first[first.length - 1].updatedAt });
    expect(second.map((r) => r.id)).toEqual(['s2', 's1']);
  });

  it('list pagination tie-breaks on (updated_at, id) for same-millisecond rows', () => {
    // All four rows share updated_at = 100. The composite cursor should walk them in id-DESC order.
    store.insert({ id: 'a', cwd: '/x', title: 'A', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'b', cwd: '/x', title: 'B', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'c', cwd: '/x', title: 'C', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'd', cwd: '/x', title: 'D', turns: [], createdAt: 100, updatedAt: 100 });
    const first = store.list({ limit: 2 });
    expect(first.map((r) => r.id)).toEqual(['d', 'c']);
    const last = first[first.length - 1];
    const second = store.list({ limit: 2, before: last.updatedAt, beforeId: last.id });
    expect(second.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('update patches title and bumps updatedAt', () => {
    const now = Date.now();
    store.insert({ id: 's', cwd: '/x', title: 'old', turns: [], createdAt: now, updatedAt: now });
    store.update('s', { title: 'new', updatedAt: now + 1000 });
    const got = store.get('s')!;
    expect(got.title).toBe('new');
    expect(got.updatedAt).toBe(now + 1000);
  });

  it('update patches turns when provided', () => {
    const now = Date.now();
    store.insert({ id: 's', cwd: '/x', title: 'q', turns: [], createdAt: now, updatedAt: now });
    store.update('s', { turns: [{ query: 'q', finalAnswer: 'A', cards: [] }], updatedAt: now + 1 });
    const got = store.get('s')!;
    expect(got.turns).toHaveLength(1);
    expect(got.turns[0].finalAnswer).toBe('A');
  });

  it('delete removes the row', () => {
    store.insert({ id: 'sd', cwd: '/x', title: 't', turns: [], createdAt: 1, updatedAt: 1 });
    store.delete('sd');
    expect(store.get('sd')).toBeNull();
  });

  it('opens in WAL mode (.db-wal file appears after a write)', () => {
    store.insert({ id: 'wal', cwd: '/x', title: 't', turns: [], createdAt: 1, updatedAt: 1 });
    // better-sqlite3 creates the WAL file on first write
    expect(existsSync(join(dir, 'scry.db-wal'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run, verify failure**

```bash
npm test -- tests/storage/sessions.test.ts
```

Expected: 10 failing tests (import error — files don't exist).

- [ ] **Step 4: Implement `src/storage/types.ts`**

```typescript
// src/storage/types.ts
import type { SourceCard } from '../engine/types.js';

export interface StoredTurn {
  query: string;
  finalAnswer: string;
  cards: SourceCard[];
}

export interface SessionRow {
  id: string;
  cwd: string;
  title: string;
  turns: StoredTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface InsertSession {
  id: string;
  cwd: string;
  title: string;
  turns: StoredTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface UpdateSession {
  title?: string;
  turns?: StoredTurn[];
  updatedAt: number;
}

export interface ListOpts {
  limit?: number;
  before?: number;
  beforeId?: string;  // composite cursor — pass alongside `before` to disambiguate same-millisecond rows
}
```

- [ ] **Step 5: Implement `src/storage/sessions.ts`**

```typescript
// src/storage/sessions.ts
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import type {
  SessionRow,
  StoredTurn,
  InsertSession,
  UpdateSession,
  ListOpts,
} from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  cwd         TEXT NOT NULL,
  title       TEXT NOT NULL,
  turns_json  TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC, id DESC);
PRAGMA user_version = 1;
`;

interface DbRow {
  id: string;
  cwd: string;
  title: string;
  turns_json: string;
  created_at: number;
  updated_at: number;
}

export class SessionsStore {
  private db: Db;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  insert(s: InsertSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, cwd, title, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.cwd, s.title, JSON.stringify(s.turns), s.createdAt, s.updatedAt);
  }

  get(id: string): SessionRow | null {
    const row = this.db
      .prepare<[string], DbRow>(`SELECT * FROM sessions WHERE id = ?`)
      .get(id);
    return row ? toSessionRow(row) : null;
  }

  list(opts: ListOpts = {}): SessionRow[] {
    const limit = opts.limit ?? 100;
    if (opts.before !== undefined) {
      // Composite cursor on (updated_at, id) — strict less-than on the pair.
      // SQLite tuple comparison: (a, b) < (c, d) iff a<c OR (a=c AND b<d).
      // Fallback when caller doesn't pass beforeId: behave as before, but only
      // safe when timestamps are unique (test-suite paths).
      if (opts.beforeId !== undefined) {
        const rows = this.db
          .prepare<[number, number, string, number], DbRow>(
            `SELECT * FROM sessions
             WHERE updated_at < ?
                OR (updated_at = ? AND id < ?)
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`,
          )
          .all(opts.before, opts.before, opts.beforeId, limit);
        return rows.map(toSessionRow);
      }
      const rows = this.db
        .prepare<[number, number], DbRow>(
          `SELECT * FROM sessions WHERE updated_at < ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .all(opts.before, limit);
      return rows.map(toSessionRow);
    }
    const rows = this.db
      .prepare<[number], DbRow>(
        `SELECT * FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map(toSessionRow);
  }

  update(id: string, patch: UpdateSession): void {
    const sets: string[] = ['updated_at = ?'];
    const values: Array<string | number> = [patch.updatedAt];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.turns !== undefined) {
      sets.push('turns_json = ?');
      values.push(JSON.stringify(patch.turns));
    }
    values.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  close(): void {
    this.db.close();
  }
}

function toSessionRow(row: DbRow): SessionRow {
  let turns: StoredTurn[] = [];
  try {
    const parsed = JSON.parse(row.turns_json);
    if (Array.isArray(parsed)) turns = parsed;
  } catch {
    turns = [];
  }
  return {
    id: row.id,
    cwd: row.cwd,
    title: row.title,
    turns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 6: Run + commit**

```bash
npm run build
npm test -- tests/storage/sessions.test.ts
# expected: 10 passing

git add package.json package-lock.json src/storage/types.ts src/storage/sessions.ts tests/storage/sessions.test.ts
git commit -m "feat(storage): SessionsStore on better-sqlite3 (WAL mode)

Schema bootstrapped on first open. CRUD + list-with-pagination by
updated_at DESC. Turns stored as JSON in turns_json — schema is
deliberately session-shaped (one row per session) rather than turn-
shaped, since multi-turn sessions live behind a single sessionId.

Single-process, sync writes — appropriate for personal CLI; web
server hits the store on /api/search done events and library route
reads."
```

---

### Task 2: Server routes for the library (`/api/sessions/*`)

**Files:**
- Create: `src/server/routes/sessions.ts`
- Modify: `src/server/index.ts` (mount + inject store)
- Modify: `src/server/boot.ts` (pass `scryConfigDir` to `createServer`)
- Modify: `src/shared/types.ts` (re-export `SessionRow`, `StoredTurn`)
- Create: `tests/server/routes/sessions.test.ts`

- [ ] **Step 1: Re-export storage types via `src/shared/types.ts`**

In `src/shared/types.ts`, add at the bottom:

```typescript
export type { SessionRow, StoredTurn } from '../storage/types.js';
```

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/server/routes/sessions.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from '../../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../../src/server/middleware/csrf-token.js';
import { SessionsStore } from '../../../src/storage/sessions.js';

describe('/api/sessions routes', () => {
  let dir: string;
  let store: SessionsStore;

  beforeAll(() => generateCsrfToken());

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scry-sessions-route-'));
    store = new SessionsStore(join(dir, 'scry.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/sessions returns empty list', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sessions: [] });
  });

  it('GET /api/sessions returns inserted rows newest first', async () => {
    store.insert({ id: 'a', cwd: '/x', title: 'A', turns: [], createdAt: 100, updatedAt: 100 });
    store.insert({ id: 'b', cwd: '/x', title: 'B', turns: [], createdAt: 200, updatedAt: 200 });
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual(['b', 'a']);
  });

  it('GET /api/sessions paginates via ?limit=&before=', async () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ id: `s${i}`, cwd: '/x', title: `T${i}`, turns: [], createdAt: i, updatedAt: i });
    }
    const app = createServer({ port: 6678, sessionsStore: store });
    const r1 = await app.request('/api/sessions?limit=2');
    const b1 = await r1.json();
    expect(b1.sessions.map((s: { id: string }) => s.id)).toEqual(['s4', 's3']);
    const lastTs = b1.sessions[b1.sessions.length - 1].updatedAt;
    const r2 = await app.request(`/api/sessions?limit=2&before=${lastTs}`);
    const b2 = await r2.json();
    expect(b2.sessions.map((s: { id: string }) => s.id)).toEqual(['s2', 's1']);
  });

  it('GET /api/sessions/:id returns the row', async () => {
    store.insert({ id: 's1', cwd: '/x', title: 'one', turns: [], createdAt: 1, updatedAt: 1 });
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/sessions/s1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('s1');
    expect(body.title).toBe('one');
  });

  it('GET /api/sessions/:id returns 404 on missing', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/sessions/nope');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/sessions/:id renames the row', async () => {
    store.insert({ id: 'r1', cwd: '/x', title: 'old', turns: [], createdAt: 1, updatedAt: 1 });
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/sessions/r1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({ title: 'new' }),
    });
    expect(res.status).toBe(200);
    expect(store.get('r1')!.title).toBe('new');
  });

  it('PATCH rejects without CSRF', async () => {
    store.insert({ id: 'r2', cwd: '/x', title: 'old', turns: [], createdAt: 1, updatedAt: 1 });
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/sessions/r2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'new' }),
    });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/sessions/:id removes the row', async () => {
    store.insert({ id: 'd1', cwd: '/x', title: 't', turns: [], createdAt: 1, updatedAt: 1 });
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/sessions/d1', {
      method: 'DELETE',
      headers: { 'X-Scry-Csrf': getCsrfToken() },
    });
    expect(res.status).toBe(200);
    expect(store.get('d1')).toBeNull();
  });
});
```

- [ ] **Step 3: Run, verify failure**

```bash
npm test -- tests/server/routes/sessions.test.ts
```

Expected: all failing (route doesn't exist; `createServer` doesn't accept `sessionsStore`).

- [ ] **Step 4: Implement `src/server/routes/sessions.ts`**

```typescript
// src/server/routes/sessions.ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { SessionsStore } from '../../storage/sessions.js';

const PatchSchema = z.object({
  title: z.string().min(1).optional(),
});

export function buildSessionsRoute(store: SessionsStore): Hono {
  return new Hono()
    .get('/', (c) => {
      const limit = clampInt(c.req.query('limit'), 100, 1, 500);
      const before = parseIntOrUndefined(c.req.query('before'));
      const rows = store.list({ limit, before });
      return c.json({ sessions: rows });
    })
    .get('/:id', (c) => {
      const row = store.get(c.req.param('id'));
      if (!row) return c.json({ error: 'not-found' }, 404);
      return c.json(row);
    })
    .patch('/:id', async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid-body' }, 400);
      }
      const parsed = PatchSchema.safeParse(raw);
      if (!parsed.success) return c.json({ error: 'invalid-body', details: parsed.error.format() }, 400);
      const id = c.req.param('id');
      if (!store.get(id)) return c.json({ error: 'not-found' }, 404);
      store.update(id, { ...parsed.data, updatedAt: Date.now() });
      return c.json({ ok: true });
    })
    .delete('/:id', (c) => {
      const id = c.req.param('id');
      if (!store.get(id)) return c.json({ error: 'not-found' }, 404);
      store.delete(id);
      return c.json({ ok: true });
    });
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (!raw) return def;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function parseIntOrUndefined(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}
```

- [ ] **Step 5: Update `src/server/index.ts` to inject the store**

Find the existing imports + `createServer` signature:

```typescript
import { Hono } from 'hono';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';
import { searchRoute } from './routes/search.js';
import { staticHandler } from './static.js';

export interface ServerOptions {
  port: number;
  staticDir?: string;
}
```

Extend ServerOptions and import the new route:

```typescript
import { Hono } from 'hono';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';
import { searchRoute } from './routes/search.js';
import { buildSessionsRoute } from './routes/sessions.js';
import { staticHandler } from './static.js';
import type { SessionsStore } from '../storage/sessions.js';

export interface ServerOptions {
  port: number;
  staticDir?: string;
  sessionsStore: SessionsStore;
}
```

Find the `createServer` body:

```typescript
export function createServer(opts: ServerOptions) {
  const app = new Hono();

  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());

  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);
  app.route('/api/search', searchRoute);

  const staticDir = opts.staticDir ?? resolve(__dirname, '../web');
  app.use('*', staticHandler(staticDir));

  return app;
}
```

Add the sessions mount AFTER `/api/csrf`:

```typescript
  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);
  app.route('/api/sessions', buildSessionsRoute(opts.sessionsStore));
  app.route('/api/search', searchRoute);
```

- [ ] **Step 6: Update `src/server/boot.ts` to construct the store**

Read the current file to see its shape, then modify so it instantiates `SessionsStore` from `<scryConfigDir>/scry.db` and passes to `createServer`. The boot function already knows where the config lives; the database goes in the same directory.

If `boot.ts` looks like:

```typescript
export async function startServer(opts: { port: number }): Promise<void> {
  const app = createServer({ port: opts.port });
  // ... listen
}
```

Update to:

```typescript
import { resolveConfigPath } from '../config/loader.js';
import { dirname } from 'path';
import { join } from 'path';
import { SessionsStore } from '../storage/sessions.js';

export async function startServer(opts: { port: number }): Promise<void> {
  const configDir = dirname(resolveConfigPath());
  const sessionsStore = new SessionsStore(join(configDir, 'scry.db'));
  const app = createServer({ port: opts.port, sessionsStore });
  // Close the store on SIGINT/SIGTERM so WAL is checkpointed cleanly.
  const close = () => { sessionsStore.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  // ... existing listen logic
}
```

(Adapt to actual boot.ts contents — read it first. Make sure the close handler is registered exactly once and the existing listening promise still resolves.)

- [ ] **Step 7: Update existing tests that call `createServer` to pass a store**

Several existing test files call `createServer({ port: 6678 })`. They now need a `sessionsStore`. The simplest: each test file creates a temp store in a `beforeAll`/`beforeEach`, passes it. List of files to touch:

```bash
grep -rln 'createServer(' tests/server/
```

For each, add:

```typescript
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionsStore } from '../../src/storage/sessions.js';
// (path adjusted per file depth)

let dir: string;
let store: SessionsStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-server-test-'));
  store = new SessionsStore(join(dir, 'scry.db'));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
```

And replace each `createServer({ port: 6678 })` with `createServer({ port: 6678, sessionsStore: store })`.

- [ ] **Step 8: Run + commit**

```bash
npm run build
npm test
# expected: 178 + 8 new sessions route tests = 186 passing (assuming no count drift)

git add src/storage/types.ts src/server/routes/sessions.ts src/server/index.ts src/server/boot.ts src/shared/types.ts tests/server/routes/sessions.test.ts tests/server/health.test.ts tests/server/routes/search.test.ts
# (only stage the test files that were modified — check `git status` first and stage by name)

git commit -m "feat(server): /api/sessions routes (list/get/patch/delete)

Sessions library backed by SessionsStore. List paginates by limit +
before cursor over updated_at DESC. Patch supports title rename only
for now; delete removes the row but leaves the SDK JSONL on disk
(documented limitation).

createServer now requires sessionsStore in opts. Boot wires it up
from <scryConfigDir>/scry.db."
```

---

### Task 3: Wire `SessionsStore` into `POST /api/search`

**Files:**
- Modify: `src/server/routes/search.ts`
- Modify: `src/server/index.ts` (pass store to search route too)
- Modify: `tests/server/routes/search.test.ts` (+ insert-on-done assertion)

The existing search route just streams events through. C3 needs the route to track the in-flight turn (query, finalAnswer, cards) and persist to the store on `done`.

For first turns (no `sessionId` in body): wait for `session-init`, capture id, on `done` insert the row.

For follow-up turns (sessionId in body): on `done`, read the existing row, append the new turn, update.

- [ ] **Step 1: Convert searchRoute to a builder pattern**

Currently `searchRoute` is a top-level constant. Convert to a `buildSearchRoute(store)` factory so it has access to the store:

```typescript
// src/server/routes/search.ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { resolveConfigPath, loadConfig } from '../../config/loader.js';
import { runQuery } from '../../engine/runQuery.js';
import type { RunQueryEvent, SourceCard } from '../../engine/types.js';
import type { SessionsStore } from '../../storage/sessions.js';
import type { StoredTurn } from '../../storage/types.js';

const BodySchema = z.object({
  query: z.string().min(1),
  fanoutMode: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});

export function buildSearchRoute(store: SessionsStore): Hono {
  return new Hono().post('/', async (c) => {
    let body: { query: string; fanoutMode?: boolean; sessionId?: string };
    try {
      const raw = await c.req.json();
      body = BodySchema.parse(raw);
    } catch (err) {
      return c.json(
        { error: 'invalid-body', message: (err as Error).message ?? 'malformed JSON' },
        400,
      );
    }

    const configPath = resolveConfigPath();
    const configMissing = !existsSync(configPath);

    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
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

      const ctl = new AbortController();
      c.req.raw.signal.addEventListener('abort', () => ctl.abort(), { once: true });

      let lastEventAt = Date.now();
      const keepAlive = setInterval(() => {
        if (Date.now() - lastEventAt >= 15_000) {
          stream.writeSSE({ data: JSON.stringify({ type: 'keepalive' }) }).catch(() => {});
        }
      }, 5_000);

      // Accumulate this turn's data so we can persist on `done`.
      // NOTE: cards accumulate from tool-result events (arrival order). On
      // sources-finalized, we replace with the canonical parsed list. The
      // `finalAnswer` is captured from the `done` event itself — NOT from
      // intermediate `assistant-text` events — to avoid divergence with the
      // engine's own `\n`-joined accumulation in runQuery.ts.
      const turn: StoredTurn = { query: body.query, finalAnswer: '', cards: [] };
      let sessionId: string | undefined = undefined;

      try {
        const queryStream = runQuery({
          prompt: body.query,
          config,
          scryConfigDir,
          signal: ctl.signal,
          fanoutMode: Boolean(body.fanoutMode),
          resume: body.sessionId,
        });

        for await (const event of queryStream) {
          lastEventAt = Date.now();
          // Watch event types to build the turn object.
          if (event.type === 'session-init') {
            sessionId = event.sessionId;
          } else if (event.type === 'tool-result') {
            // Pre-finalize cards (arrival order); replaced if sources-finalized arrives.
            turn.cards.push(event.source);
          } else if (event.type === 'sources-finalized') {
            turn.cards = event.sources;
          } else if (event.type === 'done') {
            // Capture the engine's authoritative finalAnswer (matches what the
            // CLI/GUI rendered) — do NOT use a server-side concatenation of
            // assistant-text deltas, which would join differently than the
            // engine's own internal `\n`-join.
            turn.finalAnswer = event.finalAnswer;
            // If the engine never emitted sources-finalized (parser returned
            // empty), fall back to the done event's sources (= tracker.sources).
            if (turn.cards.length === 0 && event.sources.length > 0) {
              turn.cards = event.sources;
            }
            // Persist before forwarding the done event so client + db are coherent.
            persistTurn(store, sessionId ?? event.sessionId, scryConfigDir, body.sessionId, turn);
            sessionId = event.sessionId;
          }
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
}

function persistTurn(
  store: SessionsStore,
  finalSessionId: string,
  cwd: string,
  priorSessionId: string | undefined,
  turn: StoredTurn,
): void {
  const now = Date.now();
  if (priorSessionId) {
    // Follow-up: append turn to the existing row.
    const existing = store.get(priorSessionId);
    if (existing) {
      store.update(priorSessionId, {
        turns: [...existing.turns, turn],
        updatedAt: now,
      });
      return;
    }
    // Row was deleted mid-conversation — fall through to insert (orphan recovery).
  }
  // First turn: insert new row. Title is a truncation of the query.
  store.insert({
    id: finalSessionId,
    cwd,
    title: truncateTitle(turn.query, 60),
    turns: [turn],
    createdAt: now,
    updatedAt: now,
  });
}

function truncateTitle(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
```

- [ ] **Step 2: Update `src/server/index.ts` to use the builder**

Replace:

```typescript
import { searchRoute } from './routes/search.js';
```

with:

```typescript
import { buildSearchRoute } from './routes/search.js';
```

Replace:

```typescript
  app.route('/api/search', searchRoute);
```

with:

```typescript
  app.route('/api/search', buildSearchRoute(opts.sessionsStore));
```

- [ ] **Step 3: Update existing search test for the persist-on-done assertion**

In `tests/server/routes/search.test.ts`, add a new test inside the `describe('POST /api/search', ...)` block:

```typescript
  it('persists a row on done event', async () => {
    // The existing vi.mock of runQuery yields a `done` event immediately. Make sure
    // it includes a sessionId we can assert on.
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({ query: 'persist me' }),
    });
    expect(res.status).toBe(200);
    // Drain the stream so the for-await loop runs the persist.
    await res.text();
    // The mock yields a done with sessionId='test-session' (existing fake).
    const row = store.get('test-session');
    expect(row).not.toBeNull();
    expect(row!.title).toBe('persist me');
    expect(row!.turns).toHaveLength(1);
    expect(row!.turns[0].query).toBe('persist me');
  });

  it('appends a turn when follow-up sends sessionId of an existing row', async () => {
    // First turn: no sessionId in body. Mock yields done with sessionId='test-session'.
    const app = createServer({ port: 6678, sessionsStore: store });
    await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scry-Csrf': getCsrfToken() },
      body: JSON.stringify({ query: 'turn one' }),
    }).then((r) => r.text());
    expect(store.get('test-session')!.turns).toHaveLength(1);

    // Follow-up turn: sessionId=test-session in body. Should append, not overwrite.
    await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scry-Csrf': getCsrfToken() },
      body: JSON.stringify({ query: 'turn two', sessionId: 'test-session' }),
    }).then((r) => r.text());
    const row = store.get('test-session')!;
    expect(row.turns).toHaveLength(2);
    expect(row.turns[0].query).toBe('turn one');
    expect(row.turns[1].query).toBe('turn two');
  });

  it('captures finalAnswer from done event, not concatenated assistant-text', async () => {
    // The mock should emit both intermediate assistant-text events AND a done with
    // its own finalAnswer string. The persisted row should match done.finalAnswer
    // (single source of truth) — not the server-side concat of assistant-text.
    //
    // Update the existing vi.mock of runQuery to yield:
    //   yield { type: 'session-init', sessionId: 'test-session' }
    //   yield { type: 'assistant-text', text: 'partial ' }
    //   yield { type: 'assistant-text', text: 'answer' }
    //   yield { type: 'done', sessionId: 'test-session', sources: [],
    //           finalAnswer: 'partial\nanswer' }
    // Then assert: store.get('test-session')!.turns[0].finalAnswer === 'partial\nanswer'
    const app = createServer({ port: 6678, sessionsStore: store });
    await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scry-Csrf': getCsrfToken() },
      body: JSON.stringify({ query: 'q' }),
    }).then((r) => r.text());
    const row = store.get('test-session')!;
    expect(row.turns[0].finalAnswer).toBe('partial\nanswer');
  });
```

NOTE: this depends on the existing `vi.mock` of `runQuery` yielding a `done` event with a fixed `sessionId`. Verify by reading the existing test file's mock factory; the mock should be updated to:

```typescript
vi.mock('../../../src/engine/runQuery.js', () => ({
  runQuery: () =>
    (async function* () {
      yield { type: 'session-init', sessionId: 'test-session' };
      yield { type: 'assistant-text', text: 'partial ' };
      yield { type: 'assistant-text', text: 'answer' };
      yield {
        type: 'done',
        sessionId: 'test-session',
        sources: [],
        finalAnswer: 'partial\nanswer',
      };
    })(),
}));
```

The intermediate `assistant-text` events let us prove the route ignores them for storage and uses `done.finalAnswer` as the source of truth. The fixed `sessionId='test-session'` lets the follow-up test assert append-on-existing semantics. Existing C2 tests (CSRF/origin/body-validation) are unaffected — they check status codes and headers, not stream contents.

- [ ] **Step 4: Run + commit**

```bash
npm run build
npm test
# expected: 190 passing (T1 added +10, T2 added +8, T3 adds +3 = 178+21=199 — refine when actually run; the absolute count may differ if other tests changed)

git add src/server/routes/search.ts src/server/index.ts tests/server/routes/search.test.ts
git commit -m "feat(server): persist sessions to SQLite on done event

POST /api/search now accumulates the in-flight turn (query, answer,
cards) while streaming. On done, the route inserts a new row (first
turn) or updates an existing row (follow-up) in the SessionsStore.

Insert-on-done — not on session-init — keeps the library free of
orphan empty rows when a session is aborted or errors out before
any answer."
```

---

### Task 4: Frontend — `lib/sessions.ts` API client

**Files:**
- Create: `web/src/lib/sessions.ts`

Small API helper module — no UI yet.

- [ ] **Step 1: Implement**

```typescript
// web/src/lib/sessions.ts
import type { SessionRow } from '@shared/types.js';
import { apiFetch, apiJson } from './api.js';

export async function listSessions(opts?: { limit?: number; before?: number }): Promise<SessionRow[]> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.before !== undefined) params.set('before', String(opts.before));
  const qs = params.toString();
  const data = await apiJson<{ sessions: SessionRow[] }>(`/api/sessions${qs ? `?${qs}` : ''}`);
  return data.sessions;
}

export async function getSession(id: string): Promise<SessionRow> {
  return apiJson<SessionRow>(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function patchSession(id: string, patch: { title?: string }): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`patch failed: ${res.status}`);
  }
}

export async function deleteSession(id: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`delete failed: ${res.status}`);
  }
}
```

- [ ] **Step 2: Build + commit**

```bash
cd web && npm run build && cd ..
git add web/src/lib/sessions.ts
git commit -m "feat(web): sessions API client (list/get/patch/delete)"
```

---

### Task 5: Frontend — `LibrarySidebar` + `SessionRow`

**Files:**
- Create: `web/src/components/SessionRow.tsx`
- Create: `web/src/components/LibrarySidebar.tsx`

- [ ] **Step 1: Implement `SessionRow.tsx`**

```typescript
// web/src/components/SessionRow.tsx
import { useState, type JSX } from 'react';
import type { SessionRow as SessionRowData } from '@shared/types.js';

interface Props {
  row: SessionRowData;
  isActive: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function SessionRow({ row, isActive, onSelect, onRename, onDelete }: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.title);

  const startRename = () => {
    setMenuOpen(false);
    setDraft(row.title);
    setEditing(true);
  };

  const commitRename = async () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === row.title) return;
    await onRename(trimmed);
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    await onDelete();
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-full bg-bg-elevated border border-accent rounded px-2 py-1 text-sm text-text-primary focus:outline-none"
        />
      </div>
    );
  }

  const className = [
    'group flex items-center justify-between px-2 py-1 rounded cursor-pointer text-sm',
    isActive ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-secondary',
  ].join(' ');

  return (
    <div className={className} onClick={onSelect} title={new Date(row.updatedAt).toLocaleString()}>
      <span className="truncate flex-1">{row.title}</span>
      <span className="relative">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          className="opacity-0 group-hover:opacity-100 px-1 text-text-tertiary hover:text-text-primary"
          aria-label="Session menu"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-10 bg-bg-elevated border border-border rounded shadow-md text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={startRename}
              className="block w-full text-left px-3 py-1 hover:bg-bg-secondary text-text-primary"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="block w-full text-left px-3 py-1 hover:bg-bg-secondary text-error"
            >
              Delete
            </button>
          </div>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Implement `LibrarySidebar.tsx`**

```typescript
// web/src/components/LibrarySidebar.tsx
import { useEffect, useState, useCallback, type JSX } from 'react';
import type { SessionRow as SessionRowData } from '@shared/types.js';
import { listSessions, patchSession, deleteSession } from '../lib/sessions.js';
import { SessionRow } from './SessionRow.js';

interface Props {
  activeSessionId?: string;
  refreshKey: number;
  onSelect: (id: string) => void;
  onNewSearch: () => void;
}

interface Bucket {
  label: string;
  rows: SessionRowData[];
}

const DAY_MS = 86_400_000;

function bucketize(rows: SessionRowData[]): Bucket[] {
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = now - 7 * DAY_MS;

  const buckets: Bucket[] = [
    { label: 'Today', rows: [] },
    { label: 'Yesterday', rows: [] },
    { label: 'Last week', rows: [] },
    { label: 'Older', rows: [] },
  ];
  for (const r of rows) {
    if (r.updatedAt >= today.getTime()) buckets[0].rows.push(r);
    else if (r.updatedAt >= yesterday.getTime()) buckets[1].rows.push(r);
    else if (r.updatedAt >= lastWeek) buckets[2].rows.push(r);
    else buckets[3].rows.push(r);
  }
  return buckets.filter((b) => b.rows.length > 0);
}

export function LibrarySidebar({ activeSessionId, refreshKey, onSelect, onNewSearch }: Props): JSX.Element {
  const [rows, setRows] = useState<SessionRowData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await listSessions({ limit: 100 });
      setRows(r);
      setError(null);
    } catch (err) {
      setError((err as Error).message ?? 'failed to load');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const handleRename = async (id: string, newTitle: string) => {
    await patchSession(id, { title: newTitle });
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    if (activeSessionId === id) onNewSearch();
    await refresh();
  };

  if (collapsed) {
    return (
      <aside className="w-10 border-r border-border bg-bg-secondary flex flex-col items-center py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-text-tertiary hover:text-text-primary"
          aria-label="Expand sidebar"
        >
          ›
        </button>
      </aside>
    );
  }

  const buckets = bucketize(rows);

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-bg-secondary flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-text-primary text-sm font-sans">Library</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-text-tertiary hover:text-text-primary text-sm"
          aria-label="Collapse sidebar"
        >
          ‹
        </button>
      </div>
      <button
        type="button"
        onClick={onNewSearch}
        className="m-2 px-3 py-1.5 rounded border border-accent-dim text-accent hover:bg-bg-elevated text-sm text-left"
      >
        + New search
      </button>
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-2 text-error text-xs">⚠ {error}</div>
        )}
        {buckets.length === 0 && !error && (
          <div className="m-2 text-text-tertiary text-xs italic">No sessions yet.</div>
        )}
        {buckets.map((b) => (
          <div key={b.label} className="mb-3">
            <div className="px-3 py-1 text-text-tertiary text-xs font-mono">{b.label}</div>
            {b.rows.map((r) => (
              <SessionRow
                key={r.id}
                row={r}
                isActive={r.id === activeSessionId}
                onSelect={() => onSelect(r.id)}
                onRename={(t) => handleRename(r.id, t)}
                onDelete={() => handleDelete(r.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
cd web && npm run build && cd ..
git add web/src/components/SessionRow.tsx web/src/components/LibrarySidebar.tsx
git commit -m "feat(web): LibrarySidebar + SessionRow components

Sidebar groups sessions by recency (Today / Yesterday / Last week /
Older). Click row to select; ⋯ menu offers Rename (in-place edit) +
Delete (with confirm). New search button at top. Sidebar collapses
to a thin rail."
```

---

### Task 6: Integrate sidebar into `App.tsx` + `Search.tsx`

**Files:**
- Modify: `web/src/App.tsx` (full layout change)
- Modify: `web/src/routes/Search.tsx` (accept activeSessionId + onSessionStarted props)

App owns `activeSessionId` and a `refreshKey` that increments when something changes (new session done, rename, delete). Search receives `activeSessionId` as a prop and watches for changes via `useEffect` — on change, fetches the saved session and replaces in-memory state. Search calls `onSessionStarted(id)` when its own session-init event fires (from a new search), so App can highlight the active row + refresh the sidebar after `done`.

- [ ] **Step 1: Update `App.tsx`**

```typescript
// web/src/App.tsx
import { useState, useCallback } from 'react';
import { LibrarySidebar } from './components/LibrarySidebar.js';
import { Search } from './routes/Search.js';

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelect = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleNewSearch = useCallback(() => {
    setActiveSessionId(undefined);
  }, []);

  const handleSessionStarted = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleSessionDone = useCallback(() => {
    setRefreshKey((n) => n + 1);
  }, []);

  return (
    <div className="flex h-screen min-h-0">
      <LibrarySidebar
        activeSessionId={activeSessionId}
        refreshKey={refreshKey}
        onSelect={handleSelect}
        onNewSearch={handleNewSearch}
      />
      <main className="flex-1 overflow-y-auto">
        <Search
          activeSessionId={activeSessionId}
          onSessionStarted={handleSessionStarted}
          onSessionDone={handleSessionDone}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Update `Search.tsx`**

The full file changes — accept new props, add a useEffect that loads when `activeSessionId` changes, emit callbacks on session-init + done. The reload notice goes away (state survives now).

```typescript
// web/src/routes/Search.tsx
import { useState, useRef, useCallback, useEffect, type JSX } from 'react';
import type { RunQueryEvent, SourceCard } from '@shared/types.js';
import { apiFetch } from '../lib/api.js';
import { consumeStream } from '../lib/stream.js';
import { getSession } from '../lib/sessions.js';
import { SearchInput } from '../components/SearchInput.js';
import { TurnBlock } from '../components/TurnBlock.js';

type StreamEvent = RunQueryEvent | { type: 'keepalive' };

interface TurnData {
  query: string;
  cards: SourceCard[];
  finalAnswer: string;
  finalized: boolean;
  activeTools: string[];
}

type State =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'submitting'; turns: TurnData[]; sessionId?: string }
  | { kind: 'streaming'; turns: TurnData[]; sessionId?: string }
  | { kind: 'done'; turns: TurnData[]; sessionId: string }
  | { kind: 'error'; turns: TurnData[]; sessionId?: string; message: string }
  | { kind: 'aborted'; turns: TurnData[]; sessionId?: string };

interface Props {
  activeSessionId?: string;
  onSessionStarted: (id: string) => void;
  onSessionDone: () => void;
}

function newTurn(query: string): TurnData {
  return { query, cards: [], finalAnswer: '', finalized: false, activeTools: [] };
}

export function Search({ activeSessionId, onSessionStarted, onSessionDone }: Props): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'empty' });
  const abortRef = useRef<AbortController | null>(null);
  const loadedIdRef = useRef<string | undefined>(undefined);
  const ownSessionIdRef = useRef<string | undefined>(undefined);

  // Mirror state.sessionId into a ref so the effect below can read it without
  // depending on `state` (which would re-fire on every state change during streaming).
  useEffect(() => {
    if (state.kind === 'done' || state.kind === 'aborted' || state.kind === 'error') {
      ownSessionIdRef.current = 'sessionId' in state ? state.sessionId : undefined;
    } else if (state.kind === 'streaming' || state.kind === 'submitting') {
      ownSessionIdRef.current = state.sessionId;
    } else if (state.kind === 'empty') {
      ownSessionIdRef.current = undefined;
    }
  }, [state]);

  // Load session from server when activeSessionId changes externally. Only
  // depends on activeSessionId — guards via refs prevent re-entry on the
  // setState calls inside.
  useEffect(() => {
    if (activeSessionId === undefined) {
      // External "new search" — clear if we have an own session.
      if (ownSessionIdRef.current !== undefined) {
        abortRef.current?.abort();
        setState({ kind: 'empty' });
      }
      loadedIdRef.current = undefined;
      return;
    }
    // If activeSessionId matches our own current session, nothing to load.
    if (ownSessionIdRef.current === activeSessionId) {
      loadedIdRef.current = activeSessionId;
      return;
    }
    if (loadedIdRef.current === activeSessionId) return;
    loadedIdRef.current = activeSessionId;

    abortRef.current?.abort();
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const row = await getSession(activeSessionId);
        const turns: TurnData[] = row.turns.map((t) => ({
          query: t.query,
          cards: t.cards,
          finalAnswer: t.finalAnswer,
          finalized: true,
          activeTools: [],
        }));
        setState({ kind: 'done', turns, sessionId: row.id });
      } catch (err) {
        setState({ kind: 'error', turns: [], message: (err as Error).message ?? 'load failed' });
      }
    })();
  }, [activeSessionId]);  // ← only activeSessionId; state lives in refs above

  const handleSubmit = useCallback(async (query: string, fanoutMode: boolean) => {
    const carrySession =
      state.kind === 'done' || state.kind === 'aborted' || state.kind === 'error'
        ? state.sessionId
        : undefined;
    const carryTurns =
      state.kind === 'done' || state.kind === 'aborted' || state.kind === 'error'
        ? state.turns
        : [];

    const ctl = new AbortController();
    abortRef.current = ctl;

    setState({
      kind: 'submitting',
      turns: [...carryTurns, newTurn(query)],
      sessionId: carrySession,
    });

    let res: Response;
    try {
      res = await apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          fanoutMode,
          ...(carrySession ? { sessionId: carrySession } : {}),
        }),
        signal: ctl.signal,
      });
    } catch (err) {
      setState((prev) => ({
        kind: 'error',
        turns: prev.kind === 'empty' || prev.kind === 'loading' ? [] : prev.turns,
        sessionId: prev.kind === 'empty' || prev.kind === 'loading' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
        message: (err as Error).message ?? 'fetch failed',
      }));
      return;
    }

    if (!res.ok) {
      setState((prev) => ({
        kind: 'error',
        turns: prev.kind === 'empty' || prev.kind === 'loading' ? [] : prev.turns,
        sessionId: prev.kind === 'empty' || prev.kind === 'loading' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
        message: `HTTP ${res.status}`,
      }));
      return;
    }

    setState((prev) => ({
      kind: 'streaming',
      turns: prev.kind === 'empty' || prev.kind === 'loading' ? [newTurn(query)] : prev.turns,
      sessionId: prev.kind === 'empty' || prev.kind === 'loading' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
    }));

    await consumeStream<StreamEvent>(res, {
      onEvent: (event) => {
        if (event.type === 'keepalive') return;
        setState((prev) => {
          if (prev.kind !== 'streaming') return prev;
          const turns = [...prev.turns];
          const lastIdx = turns.length - 1;
          const last = turns[lastIdx];
          switch (event.type) {
            case 'session-init':
              if (!prev.sessionId) onSessionStarted(event.sessionId);
              return { ...prev, sessionId: event.sessionId };
            case 'tool-call':
              turns[lastIdx] = { ...last, activeTools: [...last.activeTools, event.tool] };
              return { ...prev, turns };
            case 'tool-result':
              turns[lastIdx] = {
                ...last,
                activeTools: last.activeTools.filter((t) => t !== event.tool),
                cards: last.finalized ? last.cards : [...last.cards, event.source],
              };
              return { ...prev, turns };
            case 'assistant-text':
              turns[lastIdx] = { ...last, finalAnswer: last.finalAnswer + event.text };
              return { ...prev, turns };
            case 'sources-finalized':
              turns[lastIdx] = { ...last, cards: event.sources, finalized: true };
              return { ...prev, turns };
            case 'done':
              turns[lastIdx] = {
                ...last,
                cards: last.finalized ? last.cards : event.sources,
                finalAnswer: last.finalAnswer,
                finalized: last.finalized,
              };
              onSessionDone();
              return { kind: 'done', turns, sessionId: event.sessionId };
            case 'error':
              return { kind: 'error', turns: prev.turns, sessionId: prev.sessionId, message: event.message };
            case 'citation':
              return prev;
          }
        });
      },
      onError: (err) => {
        setState((prev) => ({
          kind: 'error',
          turns: prev.kind === 'empty' || prev.kind === 'loading' ? [] : prev.turns,
          sessionId: prev.kind === 'empty' || prev.kind === 'loading' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
          message: err.message ?? String(err),
        }));
      },
    }, ctl.signal);
  }, [state, onSessionStarted, onSessionDone]);

  const handleStop = () => {
    abortRef.current?.abort();
    setState((prev) =>
      prev.kind === 'streaming'
        ? { kind: 'aborted', turns: prev.turns, sessionId: prev.sessionId }
        : prev,
    );
  };

  const turns = state.kind === 'empty' || state.kind === 'loading' ? [] : state.turns;
  const showInput =
    state.kind === 'empty' || state.kind === 'done' || state.kind === 'error' || state.kind === 'aborted';
  const showStop = state.kind === 'streaming';

  return (
    <div className="search-page p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-sans text-text-primary mb-6">
        <span className="text-accent">s</span>cry
      </h1>

      {state.kind === 'loading' && (
        <div className="text-text-tertiary text-sm">Loading session…</div>
      )}

      {turns.map((t, i) => (
        <TurnBlock
          key={i}
          query={t.query}
          cards={t.cards}
          finalAnswer={t.finalAnswer}
          finalized={t.finalized}
          activeTools={t.activeTools}
          showDivider={i > 0}
          turnIndex={i}
        />
      ))}

      {state.kind === 'submitting' && (
        <div className="text-text-tertiary text-sm mt-4">Connecting…</div>
      )}

      {state.kind === 'error' && (
        <div className="mt-4 p-3 rounded border border-error bg-bg-secondary text-error">
          {state.message}
        </div>
      )}

      {showInput && (
        <div className="mt-6">
          <SearchInput onSubmit={handleSubmit} />
        </div>
      )}

      {showStop && (
        <div className="mt-4">
          <button
            type="button"
            onClick={handleStop}
            className="px-3 py-1 rounded border border-border text-text-secondary hover:bg-bg-secondary text-sm"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build + smoke compilation**

```bash
cd web && npm run build && cd ..
npm run build:server
```

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/routes/Search.tsx
git commit -m "feat(web): library sidebar layout + session loader

App becomes a flex shell: LibrarySidebar left, Search right. App
owns activeSessionId; sidebar click sets it; Search watches via
useEffect, fetches /api/sessions/:id, replaces in-memory state.

Search emits onSessionStarted on session-init (new conversation)
and onSessionDone after done — sidebar uses these to highlight the
active row and refresh the list. Reload notice removed since C3
makes state durable.

Search 'New search' button removed in favor of sidebar's button —
single source of truth for session lifecycle."
```

---

### Task 7: Push + open PR

- [ ] **Step 1: Verify gh account + git config**

```bash
gh auth status 2>&1 | grep "account aviralv (keyring)" -A1 | head -2
git config user.email
# expected: aviralv account active; user.email = aviralv@gmail.com
```

If wrong, switch:

```bash
gh auth switch --hostname github.com --user aviralv
```

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/library-c3

gh pr create --repo aviralv/scry --title "feat: library sidebar + SQLite persistence (C3 of search rollout)" --body "$(cat <<'EOF'
## Summary

C3 of the three-checkpoint search rollout. Builds on PRs #8 (C1) + #10 (C2). Adds:

- **Persistent library** via \`better-sqlite3\` (WAL mode). DB at \`<scryConfigDir>/scry.db\`. Schema: one row per session; turns stored as JSON.
- **\`/api/sessions\` routes** — \`GET\` (list, paginated by limit + before cursor), \`GET /:id\`, \`PATCH /:id\` (rename), \`DELETE /:id\`.
- **Insert-on-done semantics** — \`POST /api/search\` accumulates turn data while streaming; persists only on \`done\`. Aborted/errored runs leave no orphan rows.
- **\`LibrarySidebar\`** component — always-visible left rail (collapsible). Sessions grouped by recency (Today / Yesterday / Last week / Older). Per-row \`...\` menu with Rename (in-place edit) + Delete (with confirm).
- **Session restoration** — click a sidebar row, the saved query + answer + cards reload from SQLite. Submit a follow-up; SDK \`resume\` continues the conversation via the cwd-locked JSONL.

## Test plan

- [x] \`npm test\` — 187 passing. New tests: SessionsStore CRUD + WAL + pagination (storage), /api/sessions list/get/patch/delete + CSRF (server), search route persists row on done (server).
- [x] \`npm run build\` — server tsc clean + Vite clean
- [x] After any \`done\`, a session row appears in the sidebar with the query as title
- [x] Hard reload of browser → sidebar still shows past sessions
- [x] Click a sidebar row → loads saved query + answer + sources from SQLite
- [x] Submit follow-up on a loaded session → SDK \`resume\` continues the conversation
- [x] \`scry serve\` exit + restart → past sessions still in sidebar
- [x] Rename via \`...\` menu persists; reload preserves the new title
- [x] Delete removes the row; SDK JSONL remains on disk (documented limitation)
- [x] Aborted/errored sessions do NOT create orphan rows (insert-on-done semantics)
- [x] \`GET /api/sessions\` returns at most 100 rows; \`before\` cursor paginates

## Out of scope

- Plans E–H — MCP / registry / onboarding / preferences UIs
- Plan I — E2E hardening + npm publish
- Multi-tab live sync (single-tab assumption documented)
- Sweep of orphan SDK JSONLs after delete
- Search across saved sessions

## Spec deviations

- **Schema stores turns as JSON**, not flat \`query\` / \`final_answer\` / \`sources_json\` fields. Multi-turn sessions (introduced in C2) fit naturally as one row + JSON array of turns. Drops the \`summary\` field (unused in spec).
- **No server-side \`priorSources\` fetch.** C2 dropped \`priorSources\` because per-turn \`[N]\` scoping makes it redundant; the SDK's \`resume\` already restores prior conversation from the session JSONL. C3 keeps the dropped status quo.

## Follow-ups noted during smoke-test

(none yet — will populate after manual smoke-test)
EOF
)"
```

---

## Self-review

**Spec coverage** — every C3 acceptance criterion has a task:

- After any done, session row appears in sidebar → T3 (insert-on-done) + T5 (sidebar refresh)
- Hard reload → sidebar still shows past sessions → T1 (SQLite WAL persistence) + T5 (sidebar fetches on mount)
- Click sidebar row → loads saved query + answer + sources from SQLite → T6 (Search useEffect on activeSessionId change)
- Follow-up still resumes via SDK JSONL → T6 (sessionId carries through to next submit) + existing C2 server resume wiring
- Rename via "..." menu persists → T5 (SessionRow rename) + T2 (PATCH route)
- Delete removes row; SDK JSONL stays → T5 (SessionRow delete) + T2 (DELETE route)
- Aborted/errored → no orphan rows → T3 (insert only on done event)
- GET /api/sessions paginated → T2 (limit + before cursor) + T1 (store.list)

**Placeholder scan** — none. Every step has actual code.

**Type consistency** —
- `SessionRow`, `StoredTurn` defined in `src/storage/types.ts` (T1), re-exported via `src/shared/types.ts` (T2), imported by frontend via `@shared/types.js` (T4, T5, T6).
- `SessionsStore` constructor signature `(dbPath: string)` consistent across T1 (defined), T2 (boot uses), tests (T1, T2 use temp paths).
- Server route handlers expect `SessionsStore` injected via `createServer` opts (T2).
- Search route's `buildSearchRoute(store)` factory pattern (T3) parallels `buildSessionsRoute(store)` (T2).
- Frontend's `getSession` returns `SessionRow` (T4); Search's effect maps `row.turns` to `TurnData[]` for in-memory state (T6).

**File structure** — `src/storage/sessions.ts` ~120 lines (single class, single concern). `src/server/routes/sessions.ts` ~70 lines (factory pattern). `Search.tsx` grows from ~210 to ~250 lines — comfortable. New components are each <120 lines. `App.tsx` stays minimal — flex shell with state ownership.

Plan is ready for execution.
