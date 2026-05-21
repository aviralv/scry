import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, resolveEnvVars, resolveConfigPath } from '../../src/config/loader.js';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as os from 'os';

// vi.spyOn(os, 'homedir') doesn't work under ESM — named imports are bound at
// module load and can't be reassigned. Factory mock is required to swap homedir.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(actual.homedir),
  };
});

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

  it('loads .scry.env co-located with the resolved config (XDG branch)', () => {
    const xdgRoot = mkdtempSync(join(tmpdir(), 'scry-xdg-env-'));
    const scryDir = join(xdgRoot, 'scry');
    mkdirSync(scryDir);

    // Copy fixture config into the XDG location
    const fixtureContent = readFileSync(resolve(__dirname, '../fixtures/scry.config.yaml'), 'utf-8');
    writeFileSync(join(scryDir, 'scry.config.yaml'), fixtureContent);
    writeFileSync(join(scryDir, '.scry.env'), 'TEST_AUTH_TOKEN=from-dotenv-file');

    // Make resolution land on the XDG path: clear precedence sources
    delete process.env.SCRY_CONFIG;
    delete process.env.TEST_AUTH_TOKEN;
    process.env.XDG_CONFIG_HOME = xdgRoot;

    const tmpCwd = mkdtempSync(join(tmpdir(), 'scry-cwd-empty-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);

    try {
      const config = loadConfig();
      expect(config.llm.auth_token).toBe('from-dotenv-file');
    } finally {
      vi.restoreAllMocks();
      delete process.env.XDG_CONFIG_HOME;
      rmSync(xdgRoot, { recursive: true, force: true });
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe('resolveConfigPath', () => {
  let tmpHome: string;
  let tmpCwd: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'scry-home-'));
    tmpCwd = mkdtempSync(join(tmpdir(), 'scry-cwd-'));
    delete process.env.SCRY_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
    vi.mocked(os.homedir).mockReturnValue(tmpHome);
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns explicit path when provided, beating env/CWD/XDG', () => {
    process.env.SCRY_CONFIG = '/from/env.yaml';
    writeFileSync(join(tmpCwd, 'scry.config.yaml'), '');
    expect(resolveConfigPath('/explicit/path.yaml')).toBe('/explicit/path.yaml');
  });

  it('uses SCRY_CONFIG when no explicit arg, beating CWD/XDG', () => {
    process.env.SCRY_CONFIG = '/from/env.yaml';
    writeFileSync(join(tmpCwd, 'scry.config.yaml'), '');
    expect(resolveConfigPath()).toBe('/from/env.yaml');
  });

  it('uses CWD scry.config.yaml when it exists, beating XDG', () => {
    const cwdConfig = join(tmpCwd, 'scry.config.yaml');
    writeFileSync(cwdConfig, '');
    expect(resolveConfigPath()).toBe(cwdConfig);
  });

  it('falls through to ~/.config/scry/scry.config.yaml when nothing else hits', () => {
    expect(resolveConfigPath()).toBe(join(tmpHome, '.config', 'scry', 'scry.config.yaml'));
  });

  it('honors XDG_CONFIG_HOME when set', () => {
    const customXdg = mkdtempSync(join(tmpdir(), 'scry-xdg-'));
    process.env.XDG_CONFIG_HOME = customXdg;
    expect(resolveConfigPath()).toBe(join(customXdg, 'scry', 'scry.config.yaml'));
    rmSync(customXdg, { recursive: true, force: true });
  });

  it('treats XDG_CONFIG_HOME="" the same as unset', () => {
    process.env.XDG_CONFIG_HOME = '';
    expect(resolveConfigPath()).toBe(join(tmpHome, '.config', 'scry', 'scry.config.yaml'));
  });
});
