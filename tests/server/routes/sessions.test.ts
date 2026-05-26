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
