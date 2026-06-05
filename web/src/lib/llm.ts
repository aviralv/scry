import { apiJson } from './api.js';

export interface LlmConfigInput {
  base_url: string;
  auth_token?: string;
  model: string;
}

export interface LlmTestResult {
  ok: boolean;
  error?: string;
}

export async function putLlm(input: LlmConfigInput): Promise<{ llm: { base_url: string; model: string } }> {
  return apiJson('/api/llm', { method: 'PUT', body: JSON.stringify(input) });
}

export async function testLlm(input: LlmConfigInput): Promise<LlmTestResult> {
  return apiJson<LlmTestResult>('/api/llm/test', { method: 'POST', body: JSON.stringify(input) });
}
