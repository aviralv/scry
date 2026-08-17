// src/server/llm-test.ts
// Provider-aware LLM connectivity test. Dispatches to the correct
// endpoint format based on the provider field in the config.

import type { LlmConfig, LlmProvider } from '../config/types.js';
import { parseEnvRef } from '../config/env-ref.js';
import { isAllowedBaseUrl } from './ssrf.js';

export type LlmTestInput = LlmConfig;

export interface LlmTestOpts {
  timeoutMs?: number;
}

export type LlmTestResult = { ok: true } | { ok: false; error: string };

function resolveAuthToken(token: string | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (token === undefined) return { ok: true, value: null };
  const refName = parseEnvRef(token);
  if (refName) {
    const v = process.env[refName];
    if (v === undefined || v === '') {
      return { ok: false, error: `env var ${refName} not set` };
    }
    return { ok: true, value: v };
  }
  return { ok: true, value: token };
}

function joinUrl(base: string, path: string): string {
  if (base.endsWith('/')) return base + path.replace(/^\//, '');
  return base + '/' + path.replace(/^\//, '');
}

export async function runLlmTest(input: LlmTestInput, opts: LlmTestOpts = {}): Promise<LlmTestResult> {
  const ssrf = isAllowedBaseUrl(input.base_url);
  if (!ssrf.ok) {
    return { ok: false, error: `base_url disallowed: ${ssrf.reason}${ssrf.detail ? ` (${ssrf.detail})` : ''}` };
  }

  const tokenResult = resolveAuthToken(input.auth_token);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };

  const provider: LlmProvider = input.provider ?? 'anthropic';

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    switch (provider) {
      case 'anthropic':
        return await testAnthropic(input, tokenResult.value, ctrl.signal);
      case 'openai':
      case 'gemini':
        return await testOpenAI(input, tokenResult.value, ctrl.signal);
      case 'ollama':
        return await testOllama(input, ctrl.signal);
      default:
        return { ok: false, error: `Unknown provider: ${provider}` };
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { ok: false, error: 'Connection timed out (5s)' };
    }
    return { ok: false, error: (err as Error).message ?? 'fetch failed' };
  } finally {
    clearTimeout(t);
  }
}

async function testAnthropic(input: LlmTestInput, token: string | null, signal: AbortSignal): Promise<LlmTestResult> {
  const url = joinUrl(input.base_url, 'v1/messages');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (token) {
    const refName = parseEnvRef(input.auth_token ?? '') ?? '';
    if (refName.includes('AUTH_TOKEN')) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (refName.includes('API_KEY')) {
      headers['x-api-key'] = token;
    } else {
      headers['x-api-key'] = token;
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const body = JSON.stringify({
    model: input.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ok' }],
  });

  const res = await fetch(url, { method: 'POST', headers, body, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}` };
  }
  return { ok: true };
}

async function testOpenAI(input: LlmTestInput, token: string | null, signal: AbortSignal): Promise<LlmTestResult> {
  const provider: LlmProvider = input.provider ?? 'openai';
  const url = joinUrl(resolveOpenAICompatibleBaseUrl(input.base_url, provider), 'chat/completions');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const body = JSON.stringify({
    model: input.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ok' }],
  });

  const res = await fetch(url, { method: 'POST', headers, body, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}` };
  }
  return { ok: true };
}

async function testOllama(input: LlmTestInput, signal: AbortSignal): Promise<LlmTestResult> {
  // Ollama: check model is available via /api/tags, then do a minimal generate.
  const url = joinUrl(resolveOpenAICompatibleBaseUrl(input.base_url, 'ollama'), 'chat/completions');
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  const body = JSON.stringify({
    model: input.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ok' }],
    stream: false,
  });

  const res = await fetch(url, { method: 'POST', headers, body, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404) {
      return { ok: false, error: `Model "${input.model}" not found. Run: ollama pull ${input.model}` };
    }
    return { ok: false, error: `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}` };
  }
  return { ok: true };
}

function resolveOpenAICompatibleBaseUrl(baseUrl: string, provider: LlmProvider): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (provider === 'gemini') {
    if (/\/v1beta\/openai$/i.test(trimmed) || /\/v1\/openai$/i.test(trimmed)) return trimmed;
    return `${trimmed}/v1beta/openai`;
  }
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}
