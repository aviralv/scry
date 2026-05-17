import { describe, it, expect, vi } from 'vitest';
import { scanPathForServers } from '../../src/discovery/path-scan.js';

describe('scanPathForServers', () => {
  it('returns servers found in PATH', () => {
    const mockWhich = vi.fn((cmd: string) => cmd === 'slack-mcp' ? '/usr/local/bin/slack-mcp' : null);
    const found = scanPathForServers(mockWhich);
    expect(found.some(s => s.command === 'slack-mcp')).toBe(true);
    expect(found.some(s => s.command === 'ms365-intent-mcp')).toBe(false);
  });

  it('returns empty when nothing found', () => {
    const mockWhich = vi.fn(() => null);
    expect(scanPathForServers(mockWhich)).toEqual([]);
  });

  it('maps server name to lowercase kebab-case', () => {
    const mockWhich = vi.fn((cmd: string) => cmd === 'confluence-jira-mcp' ? '/usr/bin/confluence-jira-mcp' : null);
    const found = scanPathForServers(mockWhich);
    expect(found[0].name).toBe('confluence-jira');
  });
});
