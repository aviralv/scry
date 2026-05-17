import { describe, it, expect } from 'vitest';
import { discoverFromClaudeConfig } from '../../src/discovery/claude-config.js';

describe('discoverFromClaudeConfig', () => {
  it('extracts mcpServers from claude config', () => {
    const config = {
      mcpServers: {
        slack: { command: 'slack-mcp', args: [] },
        confluence: { command: 'confluence-jira-mcp', env: { ATLASSIAN_URL: 'https://x.atlassian.net' } },
      },
    };
    const servers = discoverFromClaudeConfig(config);
    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({ name: 'slack', command: 'slack-mcp' });
    expect(servers[1].env).toHaveProperty('ATLASSIAN_URL');
  });

  it('returns empty array if no mcpServers key', () => {
    expect(discoverFromClaudeConfig({})).toEqual([]);
  });

  it('handles malformed entries gracefully', () => {
    const config = { mcpServers: { broken: 'not an object' } };
    expect(discoverFromClaudeConfig(config)).toEqual([]);
  });

  it('handles null/undefined input', () => {
    expect(discoverFromClaudeConfig(null)).toEqual([]);
    expect(discoverFromClaudeConfig(undefined)).toEqual([]);
  });
});
