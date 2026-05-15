import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resolveEnvVars } from '../../src/config/loader.js';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('resolveEnvVars', () => {
  beforeEach(() => {
    process.env.TEST_AUTH_TOKEN = 'secret-token-123';
    process.env.TEST_SLACK_TOKEN = 'xoxb-test';
  });

  afterEach(() => {
    delete process.env.TEST_AUTH_TOKEN;
    delete process.env.TEST_SLACK_TOKEN;
  });

  it('resolves ${VAR} syntax from process.env', () => {
    const input = 'Bearer ${TEST_AUTH_TOKEN}';
    expect(resolveEnvVars(input)).toBe('Bearer secret-token-123');
  });

  it('leaves string unchanged when no env vars present', () => {
    expect(resolveEnvVars('plain-string')).toBe('plain-string');
  });

  it('resolves multiple vars in one string', () => {
    const input = '${TEST_AUTH_TOKEN}:${TEST_SLACK_TOKEN}';
    expect(resolveEnvVars(input)).toBe('secret-token-123:xoxb-test');
  });

  it('replaces unset vars with empty string', () => {
    expect(resolveEnvVars('${NONEXISTENT_VAR}')).toBe('');
  });
});

describe('loadConfig', () => {
  beforeEach(() => {
    process.env.TEST_AUTH_TOKEN = 'secret-token-123';
    process.env.TEST_SLACK_TOKEN = 'xoxb-test';
  });

  afterEach(() => {
    delete process.env.TEST_AUTH_TOKEN;
    delete process.env.TEST_SLACK_TOKEN;
  });

  it('loads and parses YAML config with env var resolution', () => {
    const configPath = resolve(__dirname, '../fixtures/scry.config.yaml');
    const config = loadConfig(configPath);

    expect(config.llm.base_url).toBe('http://localhost:6655/anthropic/');
    expect(config.llm.auth_token).toBe('secret-token-123');
    expect(config.llm.model).toBe('claude-haiku-latest');
  });

  it('resolves env vars in nested server config', () => {
    const configPath = resolve(__dirname, '../fixtures/scry.config.yaml');
    const config = loadConfig(configPath);

    expect(config.mcp_servers.slack.env?.SLACK_BOT_TOKEN).toBe('xoxb-test');
  });

  it('parses search_tools correctly', () => {
    const configPath = resolve(__dirname, '../fixtures/scry.config.yaml');
    const config = loadConfig(configPath);

    expect(config.search_tools.slack).toHaveLength(1);
    expect(config.search_tools.slack[0].tool).toBe('slack_search');
    expect(config.search_tools['confluence-jira'][0].tool).toBe('confluence_search');
  });

  it('throws on missing config file', () => {
    expect(() => loadConfig('/nonexistent/path.yaml')).toThrow();
  });
});
