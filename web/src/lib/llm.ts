import type { LlmConfig, LlmProvider } from '@shared/types.js';
import { apiJson } from './api.js';

export type { LlmConfig, LlmProvider };

export interface LlmState {
  provider: LlmProvider;
  base_url: string;
  model: string;
  auth_token: string | null;
  hasAuth: boolean;
}

export interface LlmTestResult {
  ok: boolean;
  error?: string;
}

export async function getLlm(): Promise<{ llm: LlmState | null }> {
  return apiJson('/api/llm');
}

export async function putLlm(input: LlmConfig): Promise<{ llm: { base_url: string; model: string } }> {
  return apiJson('/api/llm', { method: 'PUT', body: JSON.stringify(input) });
}

export async function testLlm(input: LlmConfig): Promise<LlmTestResult> {
  return apiJson<LlmTestResult>('/api/llm/test', { method: 'POST', body: JSON.stringify(input) });
}
