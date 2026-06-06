import type { LlmConfig } from '../config/types.js';
import { parseEnvRef } from '../config/env-ref.js';
import { isAllowedBaseUrl } from './ssrf.js';

// LlmConfig already captures base_url / model / auth_token? — reuse it.
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

  const url = joinUrl(input.base_url, 'v1/messages');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (tokenResult.value) {
    // Detect auth style by ref name when input.auth_token is a ${REF}.
    const refName = parseEnvRef(input.auth_token ?? '') ?? '';
    if (refName.includes('AUTH_TOKEN')) {
      headers['Authorization'] = `Bearer ${tokenResult.value}`;
    } else if (refName.includes('API_KEY')) {
      headers['x-api-key'] = tokenResult.value;
    } else {
      // Literal token (or unrecognized ref shape) — send both, let server pick.
      headers['x-api-key'] = tokenResult.value;
      headers['Authorization'] = `Bearer ${tokenResult.value}`;
    }
  }

  const body = JSON.stringify({
    model: input.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ok' }],
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const slice = text.slice(0, 200);
      return { ok: false, error: `${res.status} ${res.statusText}${slice ? `: ${slice}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? 'fetch failed' };
  } finally {
    clearTimeout(t);
  }
}
