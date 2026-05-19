import { writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { stringify } from 'yaml';
import { checkbox, input, confirm } from '@inquirer/prompts';
import type { ScryConfig } from '../config/types.js';
import type { DiscoveredServer } from '../discovery/claude-config.js';
import { findBundledServer } from '../config/bundled-servers.js';
import { discoverFromClaudeConfig, loadClaudeConfig } from '../discovery/claude-config.js';
import { scanPathForServers } from '../discovery/path-scan.js';
import { BUNDLED_SERVERS } from '../config/bundled-servers.js';

interface LlmOpts {
  model: string;
  base_url?: string;
  auth_token?: string;
}

interface ProjectDef {
  key: string;
  name: string;
  slackChannels?: string[];
  confluenceCql?: string;
  jiraProject?: string;
}

export function extractEnvSecrets(
  servers: DiscoveredServer[]
): { sanitized: DiscoveredServer[]; envVars: Record<string, string> } {
  const envVars: Record<string, string> = {};
  const sanitized = servers.map(server => {
    const newEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(server.env)) {
      if (typeof value !== 'string') continue;
      const isPlaceholder = /^\$\{[^}]+\}$/.test(value);
      if (isPlaceholder || value === '') {
        newEnv[key] = value;
      } else {
        envVars[key] = value;
        newEnv[key] = `\${${key}}`;
      }
    }
    return { ...server, env: newEnv };
  });
  return { sanitized, envVars };
}

export function formatDotEnv(envVars: Record<string, string>): string {
  return Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
}

export function ensureGitignored(gitignorePath: string, entry: string): void {
  if (existsSync(gitignorePath)) {
    const current = readFileSync(gitignorePath, 'utf-8');
    const lines = current.split('\n').map(l => l.trim());
    if (lines.includes(entry)) return;
    const sep = current.endsWith('\n') ? '' : '\n';
    writeFileSync(gitignorePath, current + sep + entry + '\n', 'utf-8');
  } else {
    writeFileSync(gitignorePath, entry + '\n', 'utf-8');
  }
}

export function generateConfig(
  servers: DiscoveredServer[],
  llmOpts: LlmOpts,
  projects?: ProjectDef[]
): ScryConfig {
  const mcp_servers: Record<string, any> = {};
  const search_tools: Record<string, any[]> = {};

  for (const server of servers) {
    mcp_servers[server.name] = {
      command: server.command,
      ...(server.args.length > 0 ? { args: server.args } : {}),
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    };

    // Look up search tools from bundled catalogue
    const bundled = findBundledServer(server.command);
    if (bundled) {
      search_tools[server.name] = bundled.searchTools;
    }
  }

  const config: ScryConfig = {
    llm: {
      base_url: llmOpts.base_url ?? 'https://api.anthropic.com',
      auth_token: llmOpts.auth_token ?? '${ANTHROPIC_API_KEY}',
      model: llmOpts.model,
    },
    mcp_servers,
    search_tools,
  };

  if (projects && projects.length > 0) {
    config.registry = {
      people: {},
      projects: Object.fromEntries(projects.map(p => [
        p.key,
        {
          name: p.name,
          routing: {
            ...(p.slackChannels?.length ? { slack_channels: p.slackChannels } : {}),
            ...(p.confluenceCql ? { confluence_cql: p.confluenceCql } : {}),
            ...(p.jiraProject ? { jira_project: p.jiraProject } : {}),
          },
        },
      ])),
    };
  }

  return config;
}

export async function runInit(outputDir: string = '.'): Promise<void> {
  const configPath = resolve(outputDir, 'scry.config.yaml');

  // Idempotency check
  if (existsSync(configPath)) {
    const overwrite = await confirm({
      message: 'scry.config.yaml already exists. Overwrite?',
      default: false,
    });
    if (!overwrite) {
      console.log('Aborted. Existing config preserved.');
      return;
    }
  }

  console.log('\n⟐ Discovering MCP servers...\n');

  // Discover from Claude config + PATH
  const claudeConfig = loadClaudeConfig();
  const fromClaude = discoverFromClaudeConfig(claudeConfig);
  const fromPath = scanPathForServers();

  // Merge and deduplicate by command
  const allDiscovered = [...fromClaude];
  for (const s of fromPath) {
    if (!allDiscovered.some(d => d.command === s.command)) {
      allDiscovered.push(s);
    }
  }

  if (allDiscovered.length > 0) {
    console.log(`Found ${allDiscovered.length} server(s):`);
    for (const s of allDiscovered) {
      console.log(`  ✓ ${s.name} (${s.command})`);
    }
  }

  // Show install hints for missing bundled servers
  const missing = BUNDLED_SERVERS.filter(
    b => !allDiscovered.some(d => d.command === b.command)
  );
  if (missing.length > 0) {
    console.log('\nNot found (install with uv):');
    for (const m of missing) {
      console.log(`  ✗ ${m.name}: uv tool install git+${m.githubUrl}`);
    }
  }

  // Let user select which servers to include
  const choices = allDiscovered.map(s => ({
    name: `${s.name} (${s.command})`,
    value: s,
    checked: true,
  }));

  const selectedServers = choices.length > 0
    ? await checkbox({ message: 'Select servers to configure:', choices })
    : [];

  // LLM configuration
  const model = await input({
    message: 'LLM model:',
    default: 'claude-haiku-4-5-20251001',
  });

  const useProxy = await confirm({
    message: 'Use a proxy/custom base URL?',
    default: false,
  });

  let base_url: string | undefined;
  if (useProxy) {
    base_url = await input({
      message: 'Base URL:',
      default: 'http://localhost:6655/anthropic/',
    });
  }

  // Projects (optional)
  const addProjects = await confirm({
    message: 'Define projects for context-aware routing?',
    default: false,
  });

  const projects: ProjectDef[] = [];
  if (addProjects) {
    let addMore = true;
    while (addMore) {
      const name = await input({ message: 'Project name:' });
      const key = name.toLowerCase().replace(/\s+/g, '-');
      const slackRaw = await input({ message: 'Slack channels (comma-separated, or empty):' });
      const slackChannels = slackRaw ? slackRaw.split(',').map(s => s.trim()) : undefined;
      const jiraProject = await input({ message: 'Jira project key (or empty):' }) || undefined;

      projects.push({ key, name, slackChannels, jiraProject });
      addMore = await confirm({ message: 'Add another project?', default: false });
    }
  }

  // Generate and write config
  const { sanitized, envVars } = extractEnvSecrets(selectedServers);
  const config = generateConfig(
    sanitized,
    { model, base_url, auth_token: '${ANTHROPIC_API_KEY}' },
    projects.length > 0 ? projects : undefined
  );

  writeFileSync(configPath, stringify(config), 'utf-8');
  console.log(`\n✓ Config written to ${configPath}`);

  if (Object.keys(envVars).length > 0) {
    const envPath = resolve(outputDir, '.scry.env');
    writeFileSync(envPath, formatDotEnv(envVars), 'utf-8');
    console.log(`✓ Secrets written to ${envPath}`);

    const gitignorePath = resolve(outputDir, '.gitignore');
    ensureGitignored(gitignorePath, '.scry.env');
    console.log(`✓ .scry.env added to ${gitignorePath}`);
  }

  console.log('  Run `scry "your query"` to search.');
}
