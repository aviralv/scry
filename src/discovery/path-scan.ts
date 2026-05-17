import { BUNDLED_SERVERS } from '../config/bundled-servers.js';
import { execSync } from 'child_process';
import type { DiscoveredServer } from './claude-config.js';

export function whichCommand(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8', timeout: 2000 }).trim() || null;
  } catch {
    return null;
  }
}

export function scanPathForServers(which: (cmd: string) => string | null = whichCommand): DiscoveredServer[] {
  return BUNDLED_SERVERS
    .filter(s => which(s.command) !== null)
    .map(s => ({
      name: s.name.toLowerCase().replace(/\s+&?\s*/g, '-'),
      command: s.command,
      args: [],
      env: {},
    }));
}
