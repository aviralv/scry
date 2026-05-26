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
  runQuery: async function* () {
    yield { type: 'done', sessionId: 'test-session', sources: [], finalAnswer: 'test answer' };
  },
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
});
