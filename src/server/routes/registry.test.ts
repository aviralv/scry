import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildRegistryRoute } from './registry.js';

let dir: string;
let cfg: string;
let app: Hono;

const SEED_NO_REGISTRY = `# top comment
llm: {}
mcp_servers: {}
search_tools: {}
# bottom comment
`;

const SEED_WITH_REGISTRY = `llm: {}
mcp_servers: {}
search_tools: {}
registry:
  people:
    andre:
      name: Andre Christ
      identifiers:
        slack_username: andre
  projects:
    ea:
      name: Enterprise Architecture
      routing:
        slack_channels:
          - "#ea"
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-registry-route-'));
  cfg = join(dir, 'scry.config.yaml');
  app = new Hono();
  app.route('/api/registry', buildRegistryRoute({ configPath: () => cfg }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('GET /api/registry', () => {
  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/registry');
    expect(r.status).toBe(412);
    const body = await r.json();
    expect(body.error).toBe('config-required');
  });

  it('returns empty registry when config has no registry block', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry).toEqual({ people: {}, projects: {} });
  });

  it('returns existing registry shape', async () => {
    writeFileSync(cfg, SEED_WITH_REGISTRY);
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry.people.andre.name).toBe('Andre Christ');
    expect(body.registry.projects.ea.routing.slack_channels).toEqual(['#ea']);
  });

  it('returns 500 with config-malformed when YAML is unparseable', async () => {
    writeFileSync(cfg, 'registry:\n  people:\n    andre:\n      name: "broken\n');
    const r = await app.request('/api/registry');
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe('config-malformed');
    expect(body.message).toContain('failed to read or parse config');
  });

  it('returns 500 with config-malformed when registry shape is invalid', async () => {
    // A person without `name` fails the schema.
    writeFileSync(cfg, 'registry:\n  people:\n    andre:\n      role: PM\n  projects: {}\n');
    const r = await app.request('/api/registry');
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe('config-malformed');
    expect(body.message).toContain('registry');
  });

  it('accepts an empty registry block (sub-keys default to {})', async () => {
    writeFileSync(cfg, 'registry: {}\n');
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry).toEqual({ people: {}, projects: {} });
  });

  it('accepts a registry with only people defined (projects defaults to {})', async () => {
    writeFileSync(cfg, 'registry:\n  people:\n    andre:\n      name: Andre\n      identifiers: {}\n');
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry.projects).toEqual({});
    expect(body.registry.people.andre.name).toBe('Andre');
  });
});

describe('PUT /api/registry', () => {
  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: { people: {}, projects: {} } }),
    });
    expect(r.status).toBe(412);
  });

  it('writes the registry and returns 200 with the saved registry', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const next = {
      people: { 'jens-r': { name: 'Jens', identifiers: {} } },
      projects: {},
    };
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: next }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry.people['jens-r'].name).toBe('Jens');
    expect(readFileSync(cfg, 'utf-8')).toContain('jens-r');
  });

  it('returns 400 with path-scoped errors on invalid registry', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const bad = {
      people: { 'BAD KEY': { name: 'X', identifiers: {} } },
      projects: {},
    };
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: bad }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid-body');
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toHaveProperty('path');
  });

  it('returns 400 on missing registry field in body', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders, body: '{}',
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 on malformed JSON', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders, body: 'not-json',
    });
    expect(r.status).toBe(400);
  });

  it('preserves comments outside the registry block (golden test)', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const next = { people: { x: { name: 'X', identifiers: {} } }, projects: {} };
    await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: next }),
    });
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('# top comment');
    expect(raw).toContain('# bottom comment');
  });
});
