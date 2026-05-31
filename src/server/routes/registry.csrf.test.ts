import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Hono } from 'hono';
import { csrfRequired } from '../middleware/csrf.js';
import { generateCsrfToken } from '../middleware/csrf-token.js';
import { buildRegistryRoute } from './registry.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  generateCsrfToken();
  dir = mkdtempSync(join(tmpdir(), 'scry-registry-csrf-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
  app.use('*', csrfRequired());
  app.route('/api/registry', buildRegistryRoute({ configPath: () => cfg }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CSRF enforcement on /api/registry', () => {
  it('GET works without CSRF (read-only)', async () => {
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
  });
  it('PUT without X-Scry-Csrf returns 403', async () => {
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registry: { people: {}, projects: {} } }),
    });
    expect(r.status).toBe(403);
  });
});
