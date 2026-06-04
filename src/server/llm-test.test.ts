import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runLlmTest } from './llm-test.js';

describe('runLlmTest', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.SCRY_TEST_TOKEN;
  });

  it('returns ok on a successful Anthropic-shaped response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'msg_x' }), { status: 200 }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', auth_token: 'sk-abc' });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('x-api-key')).toBe('sk-abc');
    expect(headers.get('anthropic-version')).toBeTruthy();
  });

  it('returns ok=false on 401 with a useful error message', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401, statusText: 'Unauthorized' }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: 'bad' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/401/);
    }
  });

  it('rejects an SSRF-disallowed base_url before fetching', async () => {
    const r = await runLlmTest({ base_url: 'https://10.0.0.1', model: 'm' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/private-address-blocked|disallowed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a ${REF} auth_token from process.env', async () => {
    process.env.SCRY_TEST_TOKEN = 'resolved-value';
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: '${SCRY_TEST_TOKEN}' });
    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('x-api-key')).toBe('resolved-value');
  });

  it('returns ok=false when ${REF} is not in process.env', async () => {
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: '${UNDEFINED_KEY}' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/UNDEFINED_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits x-api-key when no auth_token is provided', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const r = await runLlmTest({ base_url: 'http://localhost:6655/anthropic/', model: 'm' });
    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.has('x-api-key')).toBe(false);
  });

  it('returns ok=false on network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await runLlmTest({ base_url: 'http://localhost:6655', model: 'm' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it('respects the AbortController timeout', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const r = await runLlmTest({ base_url: 'https://api.anthropic.com', model: 'm', auth_token: 'sk-x' }, { timeoutMs: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/aborted|timed out/i);
  });

  it('joins base_url + /v1/messages even when base_url has a trailing slash', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await runLlmTest({ base_url: 'http://localhost:6655/anthropic/', model: 'm' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:6655/anthropic/v1/messages');
  });
});
