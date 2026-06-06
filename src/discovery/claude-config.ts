import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface DiscoveredServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Shape of the relevant subset of Claude's `~/.claude.json` config file.
 * We only care about `mcpServers` — the rest of the file (model preferences,
 * theme, etc.) is intentionally out of scope. Each entry is permissive:
 * Claude itself accepts partial entries, and `discoverFromClaudeConfig`
 * filters anything missing `command`.
 */
export interface ClaudeConfigShape {
  mcpServers?: Record<string, ClaudeMcpEntry>;
}

interface ClaudeMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export function discoverFromClaudeConfig(config: ClaudeConfigShape | null | undefined): DiscoveredServer[] {
  const mcpServers = config?.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object') return [];

  return Object.entries(mcpServers)
    .filter(([, def]) => def && typeof def === 'object' && typeof def.command === 'string')
    .map(([name, def]) => ({
      name,
      command: def.command ?? '',
      args: def.args ?? [],
      env: def.env ?? {},
    }));
}

export function loadClaudeConfig(): ClaudeConfigShape {
  const paths = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', 'config.json'),
  ];
  for (const p of paths) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as ClaudeConfigShape;
    } catch { continue; }
  }
  return {};
}
