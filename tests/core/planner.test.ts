import { describe, it, expect } from 'vitest';
import { buildSearchPlan } from '../../src/core/planner.js';
import { loadRegistry } from '../../src/core/registry.js';
import { detectEntities } from '../../src/core/detector.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ScryConfig } from '../../src/config/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = loadRegistry(resolve(__dirname, '../fixtures/registry.yaml'));

const config: ScryConfig = {
  llm: { base_url: 'http://localhost', auth_token: 'test', model: 'test' },
  mcp_servers: {
    slack: { command: 'slack-mcp' },
    'confluence-jira': { command: 'confluence-jira-mcp' },
    'microsoft-365': { command: 'microsoft-365-mcp' },
  },
  search_tools: {
    slack: [{ tool: 'slack_search', params: { format: 'json' } }],
    'confluence-jira': [{ tool: 'confluence_search', params: { format: 'json' } }],
    'microsoft-365': [{ tool: 'outlook_list_messages', params: { format: 'json' } }],
  },
};

describe('buildSearchPlan', () => {
  it('generates search actions for all configured sources', () => {
    const entities = detectEntities('general query', registry);
    const plan = buildSearchPlan('general query', entities, config);
    expect(plan).toHaveLength(3);
    expect(plan.map(a => a.server)).toContain('slack');
    expect(plan.map(a => a.server)).toContain('confluence-jira');
    expect(plan.map(a => a.server)).toContain('microsoft-365');
  });

  it('narrows Slack search with channel routing when project detected', () => {
    const entities = detectEntities('ECA pricing discussion', registry);
    const plan = buildSearchPlan('ECA pricing discussion', entities, config);
    const slackAction = plan.find(a => a.server === 'slack');
    expect(slackAction?.params.query).toContain('in:#team-nova-internal');
  });

  it('uses CQL routing for Confluence when project detected', () => {
    const entities = detectEntities('ECA documentation', registry);
    const plan = buildSearchPlan('ECA documentation', entities, config);
    const confluenceAction = plan.find(a => a.server === 'confluence-jira');
    expect(confluenceAction?.params.cql).toContain('space.key = NOVA');
    expect(confluenceAction?.params.cql).toContain('documentation');
  });

  it('uses person email for email search when person detected', () => {
    const entities = detectEntities('Marcus updates', registry);
    const plan = buildSearchPlan('Marcus updates', entities, config);
    const emailAction = plan.find(a => a.server === 'microsoft-365');
    expect(emailAction?.params.search).toContain('marcus.karlbowski@sap.com');
  });

  it('does broad keyword search when no entities detected', () => {
    const entities = detectEntities('random topic', registry);
    const plan = buildSearchPlan('random topic', entities, config);
    const slackAction = plan.find(a => a.server === 'slack');
    expect(slackAction?.params.query).toBe('random topic');
  });
});
