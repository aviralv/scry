import { apiJson } from './api.js';
import type { McpServerEntry } from './mcps.js';

export interface OnboardingLlm {
  base_url: string;
  model: string;
  hasAuth: boolean;
}

export interface OnboardingFlags {
  completed: boolean;
  llm_skipped?: boolean;
  mcps_skipped?: boolean;
}

export interface OnboardingState {
  llm: OnboardingLlm | null;
  mcps: McpServerEntry[];
  onboarding: OnboardingFlags;
  detectedRefs: string[];
  detectedEnvKeys: string[];
}

export interface AddOnboardingMcpInput {
  name: string;
  command: string;
  args?: string[];
  envValues: Record<string, string>;
  envRefs?: string[];
}

export async function getOnboardingState(): Promise<OnboardingState> {
  return apiJson<OnboardingState>('/api/onboarding');
}

export async function completeOnboarding(): Promise<void> {
  await apiJson<{ completed: true }>('/api/onboarding/complete', { method: 'POST' });
}

export async function skipStep(step: 'llm' | 'mcps'): Promise<OnboardingFlags> {
  const r = await apiJson<{ onboarding: OnboardingFlags }>('/api/onboarding/skip', {
    method: 'POST', body: JSON.stringify({ step }),
  });
  return r.onboarding;
}

export async function addOnboardingMcp(input: AddOnboardingMcpInput): Promise<McpServerEntry> {
  const r = await apiJson<{ server: McpServerEntry }>('/api/onboarding/mcps', {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.server;
}
