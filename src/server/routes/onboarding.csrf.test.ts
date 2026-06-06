import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildOnboardingRoute } from './onboarding.js';
import { csrfRequired } from '../middleware/csrf.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-onboarding-csrf-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
  app.use('*', csrfRequired());
  app.route('/api/onboarding', buildOnboardingRoute({
    configPath: cfg,
    envPath: join(dir, '.scry.env'),
    healthCheck: async () => ({ ok: true, toolCount: 1 }),
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CSRF on /api/onboarding', () => {
  it('rejects POST /complete without CSRF', async () => {
    const r = await app.request('/api/onboarding/complete', { method: 'POST' });
    expect(r.status).toBe(403);
  });

  it('rejects POST /skip without CSRF', async () => {
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'llm' }),
    });
    expect(r.status).toBe(403);
  });

  it('rejects POST /mcps without CSRF', async () => {
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', command: 'y', envValues: {} }),
    });
    expect(r.status).toBe(403);
  });

  it('GET does not require CSRF', async () => {
    const r = await app.request('/api/onboarding');
    expect(r.status).not.toBe(403);
  });
});
