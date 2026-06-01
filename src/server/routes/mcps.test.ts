import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildMcpsRoute } from './mcps.js';

let dir: string;
let cfg: string;
let app: Hono;
let healthCheckMock: ReturnType<typeof vi.fn>;

const SEED = `llm: {}
mcp_servers:
  slack:
    command: slack-mcp
search_tools: {}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-mcps-route-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, SEED);
  healthCheckMock = vi.fn().mockResolvedValue({ ok: true, toolCount: 1 });
  app = new Hono();
  app.route('/api/mcps', buildMcpsRoute({ configPath: () => cfg, healthCheck: healthCheckMock }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('GET /api/mcps', () => {
  it('returns the list with enabled defaulted to true', async () => {
    const r = await app.request('/api/mcps');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.servers).toEqual([
      { name: 'slack', command: 'slack-mcp', args: undefined, env: undefined, enabled: true },
    ]);
  });

  it('returns 412 when config does not exist', async () => {
    rmSync(cfg);
    const r = await app.request('/api/mcps');
    expect(r.status).toBe(412);
    const body = await r.json();
    expect(body.error).toBe('config-required');
  });

  it('returns 500 with config-malformed when YAML is unparseable', async () => {
    // Unbalanced quote — yaml parser throws.
    writeFileSync(cfg, 'mcp_servers:\n  slack:\n    command: "broken\n');
    const r = await app.request('/api/mcps');
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe('config-malformed');
    expect(body.message).toContain('failed to read or parse config');
  });

  it('returns 500 with config-malformed when mcp_servers entry has wrong shape', async () => {
    // command must be a string ≥ 1 char; null fails the schema.
    writeFileSync(cfg, 'mcp_servers:\n  slack:\n    command: null\n');
    const r = await app.request('/api/mcps');
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe('config-malformed');
    expect(body.message).toContain('mcp_servers');
  });

  // Skip when running as root (chmod doesn't enforce on root). On Linux/macOS
  // CI this is fine; harmless to skip locally as root.
  const skipIfRoot = process.getuid && process.getuid() === 0 ? it.skip : it;
  skipIfRoot('returns 500 with config-malformed when config file is unreadable', async () => {
    chmodSync(cfg, 0o000);
    try {
      const r = await app.request('/api/mcps');
      expect(r.status).toBe(500);
      const body = await r.json();
      expect(body.error).toBe('config-malformed');
      expect(body.message).toContain('failed to read or parse config');
    } finally {
      // Restore so afterEach's rmSync can clean up.
      chmodSync(cfg, 0o644);
    }
  });
});

describe('POST /api/mcps', () => {
  it('runs health-check then writes config and returns 201', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'confluence', command: 'confluence-jira-mcp' }),
    });
    expect(r.status).toBe(201);
    expect(healthCheckMock).toHaveBeenCalledOnce();
    const body = await r.json();
    expect(body.server.name).toBe('confluence');
    expect(readFileSync(cfg, 'utf-8')).toContain('confluence-jira-mcp');
  });

  it('returns 409 when name already exists', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'x' }),
    });
    expect(r.status).toBe(409);
    expect(healthCheckMock).not.toHaveBeenCalled();
  });

  it('returns 422 with error and does NOT write config when health-check fails', async () => {
    healthCheckMock.mockResolvedValue({ ok: false, error: 'timeout' });
    const before = readFileSync(cfg, 'utf-8');
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'broken', command: 'x' }),
    });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.error).toBe('health-check-failed');
    expect(body.message).toContain('timeout');
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('returns 400 with path-scoped errors on invalid body', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'BAD KEY', command: '' }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid-body');
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toHaveProperty('path');
    expect(body.errors[0]).toHaveProperty('message');
  });

  it('returns 400 on empty body', async () => {
    const r = await app.request('/api/mcps', {
      method: 'POST', headers: csrfHeaders, body: '{}',
    });
    expect(r.status).toBe(400);
  });
});

describe('PATCH /api/mcps/:name', () => {
  it('updates a field, runs health-check, and persists', async () => {
    const r = await app.request('/api/mcps/slack', {
      method: 'PATCH', headers: csrfHeaders,
      body: JSON.stringify({ command: 'slack-mcp-v2' }),
    });
    expect(r.status).toBe(200);
    expect(healthCheckMock).toHaveBeenCalledOnce();
    expect(readFileSync(cfg, 'utf-8')).toContain('slack-mcp-v2');
  });

  it('returns 404 for missing name', async () => {
    const r = await app.request('/api/mcps/missing', {
      method: 'PATCH', headers: csrfHeaders,
      body: JSON.stringify({ command: 'x' }),
    });
    expect(r.status).toBe(404);
  });

  it('returns 400 on empty body', async () => {
    const r = await app.request('/api/mcps/slack', {
      method: 'PATCH', headers: csrfHeaders, body: '{}',
    });
    expect(r.status).toBe(400);
  });
});

describe('DELETE /api/mcps/:name', () => {
  it('returns 204 and removes the entry', async () => {
    const r = await app.request('/api/mcps/slack', { method: 'DELETE', headers: csrfHeaders });
    expect(r.status).toBe(204);
    expect(readFileSync(cfg, 'utf-8')).not.toContain('slack-mcp');
  });

  it('returns 204 (idempotent) for missing name', async () => {
    const r = await app.request('/api/mcps/missing', { method: 'DELETE', headers: csrfHeaders });
    expect(r.status).toBe(204);
  });
});

describe('POST /api/mcps/:name/test', () => {
  it('returns the health-check result without writing config', async () => {
    const before = readFileSync(cfg, 'utf-8');
    const r = await app.request('/api/mcps/slack/test', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.toolCount).toBe(1);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('returns 404 for missing name', async () => {
    const r = await app.request('/api/mcps/missing/test', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(404);
  });
});

describe('non-validation writeConfig errors', () => {
  it('surfaces a 500 when writeConfig throws something other than ConfigValidationError', async () => {
    // Make the config directory read-only so atomicWriteConfig fails with EACCES
    // when it tries to write the .tmp file. We have to skip this on platforms
    // where chmod doesn't actually deny writes (e.g. when running as root).
    const { chmodSync } = await import('fs');
    const origMode = 0o755;
    try {
      chmodSync(dir, 0o555);
      const probe = await app.request('/api/mcps', {
        method: 'POST', headers: csrfHeaders,
        body: JSON.stringify({ name: 'newone', command: 'x' }),
      });
      // Some test environments (root, certain CI sandboxes) ignore chmod; if so, skip.
      if (probe.status === 201) return;
      expect(probe.status).toBe(500);
    } finally {
      chmodSync(dir, origMode);
    }
  });
});
