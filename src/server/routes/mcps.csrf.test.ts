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
