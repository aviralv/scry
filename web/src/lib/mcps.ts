import { apiJson } from './api.js';

export interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpInput {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpPatchInput {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface HealthCheckResponse {
  ok: boolean;
  toolCount?: number;
  error?: string;
}

export async function listMcps(): Promise<McpServerEntry[]> {
  const r = await apiJson<{ servers: McpServerEntry[] }>('/api/mcps');
  return r.servers;
}

export async function createMcp(input: McpInput): Promise<McpServerEntry> {
  const r = await apiJson<{ server: McpServerEntry }>('/api/mcps', {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.server;
}

export async function updateMcp(name: string, input: McpPatchInput): Promise<McpServerEntry> {
  const r = await apiJson<{ server: McpServerEntry }>(`/api/mcps/${encodeURIComponent(name)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return r.server;
}

export async function deleteMcp(name: string): Promise<void> {
  await apiJson<unknown>(`/api/mcps/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function testMcp(name: string): Promise<HealthCheckResponse> {
  return apiJson<HealthCheckResponse>(`/api/mcps/${encodeURIComponent(name)}/test`, { method: 'POST' });
}
