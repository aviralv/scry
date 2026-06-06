import { describe, it, expect } from 'vitest';
import { discoverFromClaudeConfig, type ClaudeConfigShape } from '../../src/discovery/claude-config.js';

describe('discoverFromClaudeConfig', () => {
  it('extracts mcpServers from claude config', () => {
    const config: ClaudeConfigShape = {
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
    // Deliberately wrong shape — exercises the runtime guard that
    // filters non-object entries. Cast around the type so the test
    // can assert the runtime behavior is still defensive.
    const config = { mcpServers: { broken: 'not an object' } } as unknown as ClaudeConfigShape;
    expect(discoverFromClaudeConfig(config)).toEqual([]);
  });

  it('handles null/undefined input', () => {
    expect(discoverFromClaudeConfig(null)).toEqual([]);
    expect(discoverFromClaudeConfig(undefined)).toEqual([]);
  });
});
