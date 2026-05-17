import type { ScryConfig, SearchAction, Registry } from '../config/types.js';
import type { DetectedEntities } from './detector.js';

export function buildSearchPlan(
  query: string,
  entities: DetectedEntities,
  config: ScryConfig
): SearchAction[] {
  const actions: SearchAction[] = [];
  const project = entities.projects[0] ?? null;
  const person = entities.people[0] ?? null;
  const registry = config.registry;

  for (const [server, tools] of Object.entries(config.search_tools)) {
    for (const toolConfig of tools) {
      const params: Record<string, unknown> = { ...toolConfig.params };

      if (toolConfig.tool === 'confluence_search') {
        params.cql = buildConfluenceCql(query, project, registry);
      } else if (toolConfig.tool.includes('jira')) {
        params.jql = buildJiraJql(query, project, registry);
      } else if (toolConfig.tool.includes('slack') || toolConfig.tool === 'slack_search') {
        params.query = buildSlackQuery(query, project);
      } else if (
        toolConfig.tool.includes('outlook') ||
        toolConfig.tool.includes('mail') ||
        toolConfig.tool.includes('email')
      ) {
        params.search = buildEmailQuery(query, person, registry);
      } else {
        params.query = query;
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
  project: DetectedEntities['projects'][0] | null,
  registry?: Registry
): string {
  if (project?.routing.confluence_cql) {
    return `${project.routing.confluence_cql} AND text ~ "${stripEntities(query, registry)}"`;
  }
  return `type = page AND text ~ "${query}"`;
}

function buildJiraJql(
  query: string,
  project: DetectedEntities['projects'][0] | null,
  registry?: Registry
): string {
  if (project?.routing.jira_project) {
    return `project = ${project.routing.jira_project} AND text ~ "${stripEntities(query, registry)}"`;
  }
  return `text ~ "${query}"`;
}

function buildEmailQuery(
  query: string,
  person: DetectedEntities['people'][0] | null,
  registry?: Registry
): string {
  if (person?.identifiers.email) {
    return `from:${person.identifiers.email} ${stripEntities(query, registry)}`;
  }
  return query;
}

function stripEntities(query: string, registry?: Registry): string {
  if (!registry) return query;
  const names: string[] = [];
  for (const proj of Object.values(registry.projects ?? {})) {
    names.push(proj.name);
    if (proj.aliases) names.push(...proj.aliases);
  }
  for (const person of Object.values(registry.people ?? {})) {
    names.push(person.name);
  }
  if (names.length === 0) return query;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  return query.replace(pattern, '').replace(/\s+/g, ' ').trim();
}
