import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateConfig,
  extractEnvSecrets,
  formatDotEnv,
  ensureGitignored,
} from '../../src/init/init.js';

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

describe('extractEnvSecrets', () => {
  it('moves literal env values into envVars and replaces with placeholder', () => {
    const servers = [
      { name: 'confluence', command: 'cj', args: [], env: { ATLASSIAN_URL: 'https://x.atlassian.net', ATLASSIAN_API_TOKEN: 'secret123' } },
    ];
    const { sanitized, envVars } = extractEnvSecrets(servers);
    expect(envVars).toEqual({
      ATLASSIAN_URL: 'https://x.atlassian.net',
      ATLASSIAN_API_TOKEN: 'secret123',
    });
    expect(sanitized[0].env.ATLASSIAN_URL).toBe('${ATLASSIAN_URL}');
    expect(sanitized[0].env.ATLASSIAN_API_TOKEN).toBe('${ATLASSIAN_API_TOKEN}');
  });

  it('leaves existing ${VAR} placeholders untouched', () => {
    const servers = [
      { name: 's', command: 'c', args: [], env: { TOKEN: '${TOKEN}' } },
    ];
    const { sanitized, envVars } = extractEnvSecrets(servers);
    expect(envVars).toEqual({});
    expect(sanitized[0].env.TOKEN).toBe('${TOKEN}');
  });

  it('leaves empty strings untouched', () => {
    const servers = [
      { name: 's', command: 'c', args: [], env: { OPTIONAL: '' } },
    ];
    const { sanitized, envVars } = extractEnvSecrets(servers);
    expect(envVars).toEqual({});
    expect(sanitized[0].env.OPTIONAL).toBe('');
  });

  it('returns empty envVars when no literals exist', () => {
    const servers = [{ name: 's', command: 'c', args: [], env: {} }];
    const { sanitized, envVars } = extractEnvSecrets(servers);
    expect(envVars).toEqual({});
    expect(sanitized[0].env).toEqual({});
  });

  it('handles mixed literal and placeholder values across servers', () => {
    const servers = [
      { name: 'a', command: 'a', args: [], env: { KEY1: 'literal', KEY2: '${KEY2}' } },
      { name: 'b', command: 'b', args: [], env: { KEY3: 'another' } },
    ];
    const { sanitized, envVars } = extractEnvSecrets(servers);
    expect(envVars).toEqual({ KEY1: 'literal', KEY3: 'another' });
    expect(sanitized[0].env).toEqual({ KEY1: '${KEY1}', KEY2: '${KEY2}' });
    expect(sanitized[1].env).toEqual({ KEY3: '${KEY3}' });
  });
});

describe('formatDotEnv', () => {
  it('produces KEY=value lines with trailing newline', () => {
    const out = formatDotEnv({ FOO: 'bar', BAZ: 'qux' });
    expect(out).toBe('FOO=bar\nBAZ=qux\n');
  });

  it('produces just a newline for empty input', () => {
    expect(formatDotEnv({})).toBe('\n');
  });
});

describe('ensureGitignored', () => {
  let tmpDir: string;
  let gitignorePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scry-gitignore-'));
    gitignorePath = join(tmpDir, '.gitignore');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the file when it does not exist', () => {
    ensureGitignored(gitignorePath, '.scry.env');
    expect(existsSync(gitignorePath)).toBe(true);
    expect(readFileSync(gitignorePath, 'utf-8')).toBe('.scry.env\n');
  });

  it('appends entry when missing (existing file with trailing newline)', () => {
    writeFileSync(gitignorePath, 'node_modules\ndist\n');
    ensureGitignored(gitignorePath, '.scry.env');
    expect(readFileSync(gitignorePath, 'utf-8')).toBe('node_modules\ndist\n.scry.env\n');
  });

  it('appends entry when missing (existing file without trailing newline)', () => {
    writeFileSync(gitignorePath, 'node_modules\ndist');
    ensureGitignored(gitignorePath, '.scry.env');
    expect(readFileSync(gitignorePath, 'utf-8')).toBe('node_modules\ndist\n.scry.env\n');
  });

  it('is a no-op when entry already present', () => {
    writeFileSync(gitignorePath, 'node_modules\n.scry.env\ndist\n');
    ensureGitignored(gitignorePath, '.scry.env');
    expect(readFileSync(gitignorePath, 'utf-8')).toBe('node_modules\n.scry.env\ndist\n');
  });
});
