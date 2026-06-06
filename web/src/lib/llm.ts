import type { LlmConfig } from '@shared/types.js';
import { apiJson } from './api.js';

// LlmConfigInput was a separate name for the same shape as LlmConfig — the
// server now exports LlmConfig from `@shared/types`. Keep an alias so any
// existing import sites continue to compile, but new code should import
// `LlmConfig` directly.
export type LlmConfigInput = LlmConfig;
export type { LlmConfig };

export interface LlmTestResult {
  ok: boolean;
  error?: string;
}

export async function putLlm(input: LlmConfig): Promise<{ llm: { base_url: string; model: string } }> {
  return apiJson('/api/llm', { method: 'PUT', body: JSON.stringify(input) });
}

export async function testLlm(input: LlmConfig): Promise<LlmTestResult> {
  return apiJson<LlmTestResult>('/api/llm/test', { method: 'POST', body: JSON.stringify(input) });
}
