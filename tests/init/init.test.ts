import { describe, it, expect } from 'vitest';
import { generateConfig } from '../../src/init/init.js';

describe('generateConfig', () => {
  it('builds unified config from selected servers', () => {
    const servers = [
      { name: 'slack', command: 'slack-mcp', args: [], env: {} },
    ];
    const config = generateConfig(servers, { model: 'claude-haiku-4-5-20251001' });
    expect(config.mcp_servers.slack).toBeDefined();
    expect(config.mcp_servers.slack.command).toBe('slack-mcp');
    expect(config.search_tools.slack).toBeDefined();
    expect(config.search_tools.slack[0].tool).toBe('slack_search');
  });

  it('includes registry section when projects provided', () => {
    const servers = [{ name: 'slack', command: 'slack-mcp', args: [], env: {} }];
    const projects = [{ key: 'my-project', name: 'My Project', slackChannels: ['general'] }];
    const config = generateConfig(servers, { model: 'claude-haiku-4-5-20251001' }, projects);
    expect(config.registry?.projects).toHaveProperty('my-project');
    expect(config.registry?.projects['my-project'].routing.slack_channels).toContain('general');
  });

  it('omits registry when no projects provided', () => {
    const servers = [{ name: 'slack', command: 'slack-mcp', args: [], env: {} }];
    const config = generateConfig(servers, { model: 'claude-haiku-4-5-20251001' });
    expect(config.registry).toBeUndefined();
  });

  it('uses default Anthropic base_url when none specified', () => {
    const servers = [{ name: 'slack', command: 'slack-mcp', args: [], env: {} }];
    const config = generateConfig(servers, { model: 'test-model' });
    expect(config.llm.base_url).toBe('https://api.anthropic.com');
  });

  it('includes env vars from server when present', () => {
    const servers = [{ name: 'confluence', command: 'confluence-jira-mcp', args: [], env: { ATLASSIAN_URL: 'https://x.atlassian.net' } }];
    const config = generateConfig(servers, { model: 'test' });
    expect(config.mcp_servers.confluence.env).toHaveProperty('ATLASSIAN_URL');
  });

  it('does not include empty args/env in output', () => {
    const servers = [{ name: 'slack', command: 'slack-mcp', args: [], env: {} }];
    const config = generateConfig(servers, { model: 'test' });
    expect(config.mcp_servers.slack).not.toHaveProperty('args');
    expect(config.mcp_servers.slack).not.toHaveProperty('env');
  });
});
