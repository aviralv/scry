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
