import type { BundledServer } from './types.js';

export const BUNDLED_SERVERS: BundledServer[] = [
  {
    name: 'Slack',
    command: 'slack-mcp',
    githubUrl: 'https://github.com/aviralv/slack-mcp',
    description: 'Slack search, channel history, DMs',
    searchTools: [{ tool: 'slack_search', params: { format: 'json' }, normalizer: 'slack' }],
  },
  {
    name: 'Microsoft 365',
    command: 'ms365-intent-mcp',
    githubUrl: 'https://github.com/aviralv/ms365-intent-mcp',
    description: 'Outlook email, calendar, Teams, OneDrive',
    searchTools: [{ tool: 'outlook_list_messages', params: { format: 'json' }, normalizer: 'email' }],
    envVars: ['MS365_CLIENT_ID'],
  },
  {
    name: 'Confluence & Jira',
    command: 'confluence-jira-mcp',
    githubUrl: 'https://github.com/aviralv/confluence-jira-mcp',
    description: 'Confluence pages, Jira issues',
    searchTools: [{ tool: 'confluence_search', params: { format: 'json' }, normalizer: 'confluence' }],
    envVars: ['ATLASSIAN_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'],
  },
];

export function findBundledServer(command: string): BundledServer | undefined {
  return BUNDLED_SERVERS.find(s => s.command === command);
}
