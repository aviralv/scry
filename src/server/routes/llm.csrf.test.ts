import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildLlmRoute } from './llm.js';
import { csrfRequired } from '../middleware/csrf.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-llm-csrf-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
  app.use('*', csrfRequired());
  app.route('/api/llm', buildLlmRoute({
    configPath: cfg,
    envPath: join(dir, '.scry.env'),
    llmTest: async () => ({ ok: true }),
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CSRF on /api/llm', () => {
  it('rejects PUT without CSRF header', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm' }),
    });
    expect(r.status).toBe(403);
  });

  it('rejects POST /test without CSRF header', async () => {
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm' }),
    });
    expect(r.status).toBe(403);
  });
});
