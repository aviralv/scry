import type { ScryConfig, SearchAction } from '../config/types.js';
import type { DetectedEntities } from './detector.js';

export function buildSearchPlan(
  query: string,
  entities: DetectedEntities,
  config: ScryConfig
): SearchAction[] {
  const actions: SearchAction[] = [];
  const project = entities.projects[0] ?? null;
  const person = entities.people[0] ?? null;

  for (const [server, tools] of Object.entries(config.search_tools)) {
    for (const toolConfig of tools) {
      const params: Record<string, unknown> = { ...toolConfig.params };

      if (server === 'slack') {
        params.query = buildSlackQuery(query, project);
      } else if (server === 'confluence-jira' && toolConfig.tool === 'confluence_search') {
        params.cql = buildConfluenceCql(query, project);
      } else if (server === 'confluence-jira' && toolConfig.tool === 'jira_search') {
        params.jql = buildJiraJql(query, project);
      } else if (server === 'microsoft-365') {
        params.search = buildEmailQuery(query, person);
      }

      actions.push({ server, tool: toolConfig.tool, params });
    }
  }

  return actions;
}

function buildSlackQuery(
  query: string,
  project: DetectedEntities['projects'][0] | null
): string {
  if (project?.routing.slack_channels?.length) {
    const channels = project.routing.slack_channels.map(c => `in:#${c}`).join(' ');
    return `${query} ${channels}`;
  }
  return query;
}

function buildConfluenceCql(
  query: string,
  project: DetectedEntities['projects'][0] | null
): string {
  if (project?.routing.confluence_cql) {
    return `${project.routing.confluence_cql} AND text ~ "${stripEntities(query)}"`;
  }
  return `type = page AND text ~ "${query}"`;
}

function buildJiraJql(
  query: string,
  project: DetectedEntities['projects'][0] | null
): string {
  if (project?.routing.jira_project) {
    return `project = ${project.routing.jira_project} AND text ~ "${stripEntities(query)}"`;
  }
  return `text ~ "${query}"`;
}

function buildEmailQuery(
  query: string,
  person: DetectedEntities['people'][0] | null
): string {
  if (person?.identifiers.email) {
    return `from:${person.identifiers.email} ${stripEntities(query)}`;
  }
  return query;
}

function stripEntities(query: string): string {
  return query.replace(/\b(ECA|UDA|DQ)\b/gi, '').trim().replace(/\s+/g, ' ');
}
