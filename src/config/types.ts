export interface LlmConfig {
  base_url: string;
  auth_token?: string;
  model: string;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface SearchToolConfig {
  tool: string;
  params?: Record<string, unknown>;
  normalizer?: string;
}

export interface ScryConfig {
  llm: LlmConfig;
  mcp_servers: Record<string, McpServerConfig>;
  search_tools: Record<string, SearchToolConfig[]>;
  registry?: Registry;
  onboarding?: Onboarding;
}

export interface PersonIdentifiers {
  slack_username?: string;
  email?: string;
  confluence_username?: string;
}

export interface Person {
  name: string;
  role?: string;
  teams?: string[];
  aliases?: string[];
  identifiers: PersonIdentifiers;
  projects?: string[];
}

export interface ProjectRouting {
  slack_channels?: string[];
  confluence_cql?: string;
  jira_project?: string;
}

export interface Project {
  name: string;
  aliases?: string[];
  routing: ProjectRouting;
  people?: string[];
}

export interface Registry {
  people: Record<string, Person>;
  projects: Record<string, Project>;
}

export interface Onboarding {
  completed: boolean;
  llm_skipped?: boolean;
  mcps_skipped?: boolean;
}

export interface BundledServer {
  name: string;
  slug: string;        // canonical slug used as the mcp_servers.<key> entry key
  command: string;
  githubUrl: string;
  description: string;
  searchTools: SearchToolConfig[];
  envVars?: string[];
}
