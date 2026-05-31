export interface LlmConfig {
  base_url: string;
  auth_token: string;
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

export interface SearchResult {
  source: string;
  title: string;
  snippet: string;
  author: string | null;
  timestamp: string;
  url: string | null;
  metadata: Record<string, string>;
  confidence?: 'high' | 'low';
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

export interface BundledServer {
  name: string;
  command: string;
  githubUrl: string;
  description: string;
  searchTools: SearchToolConfig[];
  envVars?: string[];
}
