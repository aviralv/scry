import { describe, it, expect } from 'vitest';
import { BUNDLED_SERVERS, findBundledServer } from '../../src/config/bundled-servers.js';

describe('bundled-servers', () => {
  it('contains three known servers', () => {
    expect(BUNDLED_SERVERS).toHaveLength(3);
    expect(BUNDLED_SERVERS.map(s => s.command)).toContain('slack-mcp');
    expect(BUNDLED_SERVERS.map(s => s.command)).toContain('ms365-intent-mcp');
    expect(BUNDLED_SERVERS.map(s => s.command)).toContain('confluence-jira-mcp');
  });

  it('findBundledServer matches by command name', () => {
    const server = findBundledServer('slack-mcp');
    expect(server).toBeDefined();
    expect(server!.searchTools.length).toBeGreaterThan(0);
  });

  it('returns undefined for unknown server', () => {
    expect(findBundledServer('unknown-mcp')).toBeUndefined();
  });
});
