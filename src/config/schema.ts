import { z } from 'zod';

const ENV_REF_SRC = '\\$\\{[A-Z][A-Z0-9_]*\\}';
const SAFE_LITERAL_SRC = '[A-Za-z0-9._/=:@+-]+';
const ENV_VALUE_RE = new RegExp(`^(?:${ENV_REF_SRC}|${SAFE_LITERAL_SRC})$`);
const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export const McpServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string().regex(ENV_VALUE_RE)).optional(),
  enabled: z.boolean().optional(),
});

export const PersonSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  teams: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  identifiers: z.object({
    slack_username: z.string().optional(),
    email: z.string().email().optional(),
    confluence_username: z.string().optional(),
  }).default({}),
  projects: z.array(z.string()).optional(),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  routing: z.object({
    slack_channels: z.array(z.string()).optional(),
    confluence_cql: z.string().optional(),
    jira_project: z.string().optional(),
  }).default({}),
  people: z.array(z.string()).optional(),
});

export const RegistrySchema = z.object({
  people: z.record(z.string().regex(SLUG_RE), PersonSchema),
  projects: z.record(z.string().regex(SLUG_RE), ProjectSchema),
});

export const McpServersMapSchema = z.record(z.string().regex(SLUG_RE), McpServerConfigSchema);
