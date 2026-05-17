import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface DiscoveredServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function discoverFromClaudeConfig(config: any): DiscoveredServer[] {
  const mcpServers = config?.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object') return [];

  return Object.entries(mcpServers)
    .filter(([_, def]) => def && typeof def === 'object' && 'command' in (def as any))
    .map(([name, def]: [string, any]) => ({
      name,
      command: def.command ?? '',
      args: def.args ?? [],
      env: def.env ?? {},
    }));
}

export function loadClaudeConfig(): any {
  const paths = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', 'config.json'),
  ];
  for (const p of paths) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch { continue; }
  }
  return {};
}
