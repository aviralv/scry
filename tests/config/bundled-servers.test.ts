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

  it('uses current intent-tool names for bundled search tools', () => {
    expect(findBundledServer('slack-mcp')?.searchTools[0].tool).toBe('slack_search');
    expect(findBundledServer('ms365-intent-mcp')?.searchTools[0].tool).toBe('find');
    expect(findBundledServer('confluence-jira-mcp')?.searchTools[0].tool).toBe('atlassian_search');
  });

  it('returns undefined for unknown server', () => {
    expect(findBundledServer('unknown-mcp')).toBeUndefined();
  });
});

describe('BUNDLED_SERVERS slugs', () => {
  it('every entry has a slug matching the McpServersMap SLUG regex', () => {
    const SLUG = /^[a-z][a-z0-9_-]{0,63}$/;
    for (const s of BUNDLED_SERVERS) {
      expect(SLUG.test(s.slug), `${s.name} has slug "${s.slug}"`).toBe(true);
    }
  });

  it('slugs are unique', () => {
    const slugs = BUNDLED_SERVERS.map(s => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('exposes the expected canonical slugs', () => {
    expect(BUNDLED_SERVERS.map(s => s.slug).sort()).toEqual(['confluence-jira', 'ms365', 'slack']);
  });
});
