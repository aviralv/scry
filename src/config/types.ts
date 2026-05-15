export interface LlmConfig {
  base_url: string;
  auth_token: string;
  model: string;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SearchToolConfig {
  tool: string;
  params?: Record<string, unknown>;
}

export interface ScryConfig {
  llm: LlmConfig;
  mcp_servers: Record<string, McpServerConfig>;
  search_tools: Record<string, SearchToolConfig[]>;
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

export interface SearchResult {
  source: 'slack' | 'confluence' | 'jira' | 'email' | 'teams';
  title: string;
  snippet: string;
  author: string | null;
  timestamp: string;
  url: string | null;
  metadata: Record<string, string>;
}

export interface SearchAction {
  server: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface Citation {
  index: number;
  source: string;
  title: string;
  url: string | null;
  author: string | null;
  timestamp: string;
}

export interface SynthesisResult {
  answer: string;
  citations: Citation[];
}
