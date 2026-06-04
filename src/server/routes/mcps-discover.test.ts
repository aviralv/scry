import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildMcpsDiscoverRoute } from './mcps-discover.js';
import { BUNDLED_SERVERS } from '../../config/bundled-servers.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-discover-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('GET /api/mcps/discover', () => {
  it('returns bundled list and pathInstalled (none on PATH)', async () => {
    app.route('/api/mcps/discover', buildMcpsDiscoverRoute({
      configPath: () => cfg,
      which: () => null,
    }));
    const r = await app.request('/api/mcps/discover');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.bundled).toHaveLength(BUNDLED_SERVERS.length);
    expect(body.bundled[0]).toMatchObject({ slug: expect.any(String), command: expect.any(String) });
    expect(body.pathInstalled).toEqual([]);
  });

  it('returns the commands found on PATH', async () => {
    app.route('/api/mcps/discover', buildMcpsDiscoverRoute({
      configPath: () => cfg,
      which: (cmd) => (cmd === 'slack-mcp' ? '/usr/local/bin/slack-mcp' : null),
    }));
    const r = await app.request('/api/mcps/discover');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.pathInstalled).toEqual(['slack-mcp']);
  });

  it('returns 412 when config does not exist', async () => {
    rmSync(cfg);
    app.route('/api/mcps/discover', buildMcpsDiscoverRoute({
      configPath: () => cfg,
      which: () => null,
    }));
    const r = await app.request('/api/mcps/discover');
    expect(r.status).toBe(412);
  });
});
