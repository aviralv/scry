import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildLlmRoute } from './llm.js';

let dir: string;
let cfg: string;
let envPath: string;
let app: Hono;
let llmTestMock: ReturnType<typeof vi.fn>;

const SEED = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-llm-route-'));
  cfg = join(dir, 'scry.config.yaml');
  envPath = join(dir, '.scry.env');
  writeFileSync(cfg, SEED);
  llmTestMock = vi.fn().mockResolvedValue({ ok: true });
  app = new Hono();
  app.route('/api/llm', buildLlmRoute({
    configPath: () => cfg,
    envPath: () => envPath,
    llmTest: llmTestMock,
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('POST /api/llm/test', () => {
  it('returns 200 ok=true when llmTest succeeds', async () => {
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', auth_token: 'sk-x' }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(llmTestMock).toHaveBeenCalledOnce();
  });

  it('returns 200 ok=false on llmTest failure', async () => {
    llmTestMock.mockResolvedValue({ ok: false, error: '401 unauthorized' });
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: 'bad' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('401');
  });

  it('returns 400 with SSRF error on disallowed base_url', async () => {
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://10.0.0.1', model: 'm' }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid-body');
    expect(JSON.stringify(body)).toMatch(/base_url|private/);
    expect(llmTestMock).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON', async () => {
    const r = await app.request('/api/llm/test', { method: 'POST', headers: csrfHeaders, body: '{' });
    expect(r.status).toBe(400);
  });

  it('returns 400 on body that fails LlmConfigSchema (e.g., missing model)', async () => {
    const r = await app.request('/api/llm/test', {
      method: 'POST', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com' }),
    });
    expect(r.status).toBe(400);
  });
});

describe('PUT /api/llm', () => {
  it('writes the llm block when given a ${REF} auth_token', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', auth_token: '${ANTHROPIC_API_KEY}', model: 'claude-haiku-4-5-20251001' }),
    });
    expect(r.status).toBe(200);
    const out = readFileSync(cfg, 'utf-8');
    expect(out).toMatch(/auth_token:\s*\$\{ANTHROPIC_API_KEY\}/);
    expect(existsSync(envPath)).toBe(false);
  });

  it('writes literal token to .scry.env and rewrites config to ${SCRY_LLM_TOKEN}', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', auth_token: 'sk-real-value', model: 'claude-haiku-4-5-20251001' }),
    });
    expect(r.status).toBe(200);
    const cfgOut = readFileSync(cfg, 'utf-8');
    expect(cfgOut).toMatch(/auth_token:\s*\$\{SCRY_LLM_TOKEN\}/);
    const envOut = readFileSync(envPath, 'utf-8');
    expect(envOut).toContain('SCRY_LLM_TOKEN=sk-real-value\n');
  });

  it('rejects an SSRF-disallowed base_url', async () => {
    const before = readFileSync(cfg, 'utf-8');
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://10.0.0.1', model: 'm' }),
    });
    expect(r.status).toBe(400);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('returns 412 when config does not exist', async () => {
    rmSync(cfg);
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', model: 'm' }),
    });
    expect(r.status).toBe(412);
  });

  it('clears onboarding.llm_skipped on successful write', async () => {
    writeFileSync(cfg, SEED + 'onboarding:\n  completed: false\n  llm_skipped: true\n');
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'https://api.anthropic.com', auth_token: '${ANTHROPIC_API_KEY}', model: 'm' }),
    });
    expect(r.status).toBe(200);
    const out = readFileSync(cfg, 'utf-8');
    expect(out).not.toMatch(/llm_skipped:\s*true/);
    expect(out).toMatch(/completed:\s*false/);   // sibling field must survive surgical removal
  });

  it('handles a config with no auth_token (proxy case)', async () => {
    const r = await app.request('/api/llm', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ base_url: 'http://localhost:6655/anthropic/', model: 'claude-haiku-4-5-20251001' }),
    });
    expect(r.status).toBe(200);
    const out = readFileSync(cfg, 'utf-8');
    expect(out).toContain('http://localhost:6655/anthropic/');
    expect(existsSync(envPath)).toBe(false);
  });
});
