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
    const res = await makeApp().request('/ok', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('accepts http://localhost:6678', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://localhost:6678' } });
    expect(res.status).toBe(200);
  });

  it('accepts http://127.0.0.1:6678', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://127.0.0.1:6678' } });
    expect(res.status).toBe(200);
  });

  it('rejects http://evil.example.com', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://evil.example.com' } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('origin-rejected');
  });

  it('rejects https://localhost:6678 (wrong scheme)', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'https://localhost:6678' } });
    expect(res.status).toBe(403);
  });

  it('rejects http://localhost:9999 (wrong port)', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://localhost:9999' } });
    expect(res.status).toBe(403);
  });
});
