import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createServer } from '../../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../../src/server/middleware/csrf-token.js';

// Mock runQuery so test 4 doesn't spawn real MCP child processes.
// The real config exists at ~/.config/scry/scry.config.yaml on this machine.
vi.mock('../../../src/engine/runQuery.js', () => ({
  runQuery: async function* () {
    yield { type: 'done', sessionId: 'test-session', sources: [], finalAnswer: 'test answer' };
  },
}));

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
