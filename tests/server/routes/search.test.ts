import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-search-test-'));
  store = new SessionsStore(join(dir, 'scry.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

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
    const row = store.get('test-session');
    expect(row).not.toBeNull();
    expect(row!.title).toBe('persist me');
    expect(row!.turns).toHaveLength(1);
    expect(row!.turns[0].query).toBe('persist me');
  });

  it('appends a turn when follow-up sends sessionId of an existing row', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    // First turn: no sessionId in body. Mock yields done with sessionId='test-session'.
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
    const app = createServer({ port: 6678, sessionsStore: store });
    await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scry-Csrf': getCsrfToken() },
      body: JSON.stringify({ query: 'q' }),
    }).then((r) => r.text());
    const row = store.get('test-session')!;
    // The engine's authoritative finalAnswer in the mock is 'partial\nanswer'.
    // Server-side concat of the two assistant-text deltas would yield 'partial answer'
    // (no newline). The persisted value must match the engine, not the concat.
    expect(row.turns[0].finalAnswer).toBe('partial\nanswer');
  });
});
