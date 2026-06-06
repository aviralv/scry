import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from '../../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../../src/server/middleware/csrf-token.js';
import { SessionsStore } from '../../../src/storage/sessions.js';

// Mock runQuery so test 4 doesn't spawn real MCP child processes.
// The real config exists at ~/.config/scry/scry.config.yaml on this machine.
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

let dir: string;
let store: SessionsStore;
let configDir: string;
let prevScryConfig: string | undefined;

beforeAll(() => {
  // Stub a config file at a known path so the search route doesn't take the
  // `configMissing` early-return branch. The runQuery mock above means we
  // never actually use these values — but the route reads + parses the file
  // before invoking the engine. CI runners don't have ~/.config/scry, so
  // without this the route bails out before reaching persistTurn (the bug
  // this test was missing on Ubuntu Node 20 in CI for PR #22).
  configDir = mkdtempSync(join(tmpdir(), 'scry-search-cfg-'));
  const configPath = join(configDir, 'scry.config.yaml');
  writeFileSync(configPath, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n', 'utf-8');
  prevScryConfig = process.env.SCRY_CONFIG;
  process.env.SCRY_CONFIG = configPath;
});

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true });
  if (prevScryConfig === undefined) delete process.env.SCRY_CONFIG;
  else process.env.SCRY_CONFIG = prevScryConfig;
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-search-test-'));
  store = new SessionsStore(join(dir, 'scry.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Wait until a session row is visible in the store. The streamSSE handler
 * runs `persistTurn` inline on the `done` event, but on some Node versions
 * the response body's `.text()` resolves before the SSE generator's
 * microtasks have flushed (Node 20 vs Node 22+ behave differently here).
 * Poll briefly so the test is platform-independent.
 */
async function waitForRow(id: string, timeoutMs = 2000): Promise<NonNullable<ReturnType<typeof store.get>>> {
  const start = Date.now();
  for (;;) {
    const row = store.get(id);
    if (row) return row;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForRow: row "${id}" did not appear within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('POST /api/search', () => {
  beforeAll(() => generateCsrfToken());

  it('rejects without CSRF header', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects bad-origin', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
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
    const app = createServer({ port: 6678, sessionsStore: store });
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
    const app = createServer({ port: 6678, sessionsStore: store });
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

  it('accepts sessionId in body for follow-up turns', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({ query: 'follow-up', sessionId: 'sess-prior-1' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/event-stream/);
  });

  it('rejects sessionId of wrong type', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({ query: 'q', sessionId: 123 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-body');
  });

  it('persists a row on done event', async () => {
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
    const row = await waitForRow('test-session');
    expect(row.title).toBe('persist me');
    expect(row.turns).toHaveLength(1);
    expect(row.turns[0].query).toBe('persist me');
  });

  it('appends a turn when follow-up sends sessionId of an existing row', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    // First turn: no sessionId in body. Mock yields done with sessionId='test-session'.
    const r1 = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scry-Csrf': getCsrfToken() },
      body: JSON.stringify({ query: 'turn one' }),
    });
    await r1.text();
    const firstTurnRow = await waitForRow('test-session');
    expect(firstTurnRow.turns).toHaveLength(1);

    // Follow-up turn: sessionId=test-session in body. Should append, not overwrite.
    const r2 = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scry-Csrf': getCsrfToken() },
      body: JSON.stringify({ query: 'turn two', sessionId: 'test-session' }),
    });
    await r2.text();
    // Wait for the second turn to land — the row already exists, but turns.length
    // grows from 1 → 2 asynchronously after the mocked done event.
    const start = Date.now();
    let row = store.get('test-session')!;
    while (row.turns.length < 2 && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 10));
      row = store.get('test-session')!;
    }
    expect(row.turns).toHaveLength(2);
    expect(row.turns[0].query).toBe('turn one');
    expect(row.turns[1].query).toBe('turn two');
  });

  it('captures finalAnswer from done event, not concatenated assistant-text', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scry-Csrf': getCsrfToken() },
      body: JSON.stringify({ query: 'q' }),
    });
    await res.text();
    const row = await waitForRow('test-session');
    // The engine's authoritative finalAnswer in the mock is 'partial\nanswer'.
    // Server-side concat of the two assistant-text deltas would yield 'partial answer'
    // (no newline). The persisted value must match the engine, not the concat.
    expect(row.turns[0].finalAnswer).toBe('partial\nanswer');
  });
});
