import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildOnboardingRoute } from './onboarding.js';

let dir: string;
let cfg: string;
let envPath: string;
let app: Hono;
let healthCheckMock: ReturnType<typeof vi.fn>;

const SEED_FRESH = `llm: {}
mcp_servers: {}
search_tools: {}
`;

const SEED_LLM_ONLY = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

const SEED_LLM_AND_MCPS = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers:
  slack:
    command: slack-mcp
    env:
      SLACK_TOKEN: \${SLACK_TOKEN}
search_tools: {}
onboarding:
  completed: false
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-onboarding-'));
  cfg = join(dir, 'scry.config.yaml');
  envPath = join(dir, '.scry.env');
  healthCheckMock = vi.fn().mockResolvedValue({ ok: true, toolCount: 1 });
  app = new Hono();
  app.route('/api/onboarding', buildOnboardingRoute({
    configPath: () => cfg,
    envPath: () => envPath,
    healthCheck: healthCheckMock,
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('GET /api/onboarding', () => {
  it('returns null llm + empty mcps + completed:false on a fresh config', async () => {
    writeFileSync(cfg, SEED_FRESH);
    const r = await app.request('/api/onboarding');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.llm).toBeNull();
    expect(body.mcps).toEqual([]);
    expect(body.onboarding).toMatchObject({ completed: false });
  });

  it('returns llm shape + hasAuth (boolean only, no token leakage)', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding');
    const body = await r.json();
    expect(body.llm).toEqual({ base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', hasAuth: true });
    expect(JSON.stringify(body)).not.toContain('${ANTHROPIC_API_KEY}');
  });

  it('returns mcps with the standard McpServerEntry shape', async () => {
    writeFileSync(cfg, SEED_LLM_AND_MCPS);
    const r = await app.request('/api/onboarding');
    const body = await r.json();
    expect(body.mcps).toHaveLength(1);
    expect(body.mcps[0]).toMatchObject({ name: 'slack', command: 'slack-mcp', enabled: true });
  });

  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/onboarding');
    expect(r.status).toBe(412);
  });

  it('reports detected env keys from .scry.env (no values)', async () => {
    writeFileSync(cfg, SEED_FRESH);
    writeFileSync(envPath, 'SLACK_TOKEN=xoxb-secret\nMS365_CLIENT_ID=abc\nANTHROPIC_AUTH_TOKEN=tok\n');
    const r = await app.request('/api/onboarding');
    const body = await r.json();
    expect(body.detectedEnvKeys).toEqual(expect.arrayContaining(['SLACK_TOKEN', 'MS365_CLIENT_ID', 'ANTHROPIC_AUTH_TOKEN']));
    expect(body.detectedRefs).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(JSON.stringify(body)).not.toContain('xoxb-secret');
    expect(JSON.stringify(body)).not.toContain('tok');
  });
});

describe('POST /api/onboarding/complete', () => {
  it('writes completed:true', async () => {
    writeFileSync(cfg, SEED_LLM_AND_MCPS);
    const r = await app.request('/api/onboarding/complete', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(200);
    expect(readFileSync(cfg, 'utf-8')).toMatch(/completed:\s*true/);
  });

  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/onboarding/complete', { method: 'POST', headers: csrfHeaders });
    expect(r.status).toBe(412);
  });
});

describe('POST /api/onboarding/skip', () => {
  it('sets llm_skipped:true on step=llm', async () => {
    writeFileSync(cfg, SEED_FRESH);
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ step: 'llm' }),
    });
    expect(r.status).toBe(200);
    expect(readFileSync(cfg, 'utf-8')).toMatch(/llm_skipped:\s*true/);
  });

  it('sets mcps_skipped:true on step=mcps', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ step: 'mcps' }),
    });
    expect(r.status).toBe(200);
    expect(readFileSync(cfg, 'utf-8')).toMatch(/mcps_skipped:\s*true/);
  });

  it('returns 400 on invalid step', async () => {
    writeFileSync(cfg, SEED_FRESH);
    const r = await app.request('/api/onboarding/skip', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ step: 'confirm' }),
    });
    expect(r.status).toBe(400);
  });
});

describe('POST /api/onboarding/mcps', () => {
  it('writes config + .scry.env atomically and returns 201', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({
        name: 'slack',
        command: 'slack-mcp',
        envValues: { SLACK_TOKEN: 'xoxb-real' },
      }),
    });
    expect(r.status).toBe(201);
    expect(healthCheckMock).toHaveBeenCalledOnce();
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toContain('slack:');
    expect(cfgOut).toMatch(/SLACK_TOKEN:\s*\$\{SLACK_TOKEN\}/);
    expect(readFileSync(envPath, 'utf-8')).toContain('SLACK_TOKEN=xoxb-real\n');
  });

  it('clears mcps_skipped on successful add', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY + 'onboarding:\n  completed: false\n  mcps_skipped: true\n');
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } }),
    });
    expect(r.status).toBe(201);
    const out = readFileSync(cfg, 'utf-8');
    expect(out).not.toMatch(/mcps_skipped:\s*true/);
    expect(out).toMatch(/completed:\s*false/);   // sibling field must survive
  });

  it('returns 422 on health-check failure with no fs writes', async () => {
    healthCheckMock.mockResolvedValue({ ok: false, error: 'spawn failed' });
    writeFileSync(cfg, SEED_LLM_ONLY);
    const before = readFileSync(cfg, 'utf-8');
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'bad' } }),
    });
    expect(r.status).toBe(422);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('returns 409 on duplicate name', async () => {
    writeFileSync(cfg, SEED_LLM_AND_MCPS);
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } }),
    });
    expect(r.status).toBe(409);
  });

  it('handles a custom MCP with explicit env block (no envVars metadata)', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({
        name: 'custom-mcp',
        command: 'my-custom-mcp',
        args: ['--flag'],
        envValues: { CUSTOM_TOKEN: 'value' },
      }),
    });
    expect(r.status).toBe(201);
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toContain('custom-mcp:');
    expect(cfgOut).toMatch(/CUSTOM_TOKEN:\s*\$\{CUSTOM_TOKEN\}/);
  });

  it('accepts envRefs for keys already in .scry.env (no .scry.env write)', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    writeFileSync(envPath, 'ATLASSIAN_URL=https://x\nATLASSIAN_API_TOKEN=tok\n');
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({
        name: 'confluence-jira',
        command: 'confluence-jira-mcp',
        envValues: {},
        envRefs: ['ATLASSIAN_URL', 'ATLASSIAN_API_TOKEN'],
      }),
    });
    expect(r.status).toBe(201);
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toContain('confluence-jira:');
    expect(cfgOut).toMatch(/ATLASSIAN_URL:\s*\$\{ATLASSIAN_URL\}/);
    expect(cfgOut).toMatch(/ATLASSIAN_API_TOKEN:\s*\$\{ATLASSIAN_API_TOKEN\}/);
    // .scry.env should still have its original values, not be overwritten
    expect(readFileSync(envPath, 'utf-8')).toContain('ATLASSIAN_URL=https://x');
  });

  it('combines envValues and envRefs (override case)', async () => {
    writeFileSync(cfg, SEED_LLM_ONLY);
    writeFileSync(envPath, 'ATLASSIAN_URL=https://old\nATLASSIAN_EMAIL=old@x.com\n');
    const r = await app.request('/api/onboarding/mcps', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({
        name: 'confluence-jira',
        command: 'confluence-jira-mcp',
        envValues: { ATLASSIAN_API_TOKEN: 'newly-typed' },
        envRefs: ['ATLASSIAN_URL', 'ATLASSIAN_EMAIL'],
      }),
    });
    expect(r.status).toBe(201);
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toMatch(/ATLASSIAN_URL:\s*\$\{ATLASSIAN_URL\}/);
    expect(cfgOut).toMatch(/ATLASSIAN_EMAIL:\s*\$\{ATLASSIAN_EMAIL\}/);
    expect(cfgOut).toMatch(/ATLASSIAN_API_TOKEN:\s*\$\{ATLASSIAN_API_TOKEN\}/);
    const envOut = readFileSync(envPath, 'utf-8');
    expect(envOut).toContain('ATLASSIAN_URL=https://old');    // unchanged
    expect(envOut).toContain('ATLASSIAN_EMAIL=old@x.com');    // unchanged
    expect(envOut).toContain('ATLASSIAN_API_TOKEN=newly-typed');  // new
  });
});
