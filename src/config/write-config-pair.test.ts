import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeConfigAndEnv } from './write-config-pair.js';
import { ConfigValidationError } from './write-config.js';

let dir: string;
let cfgPath: string;
let envPath: string;

const SEED_CFG = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-pair-'));
  cfgPath = join(dir, 'scry.config.yaml');
  envPath = join(dir, '.scry.env');
  writeFileSync(cfgPath, SEED_CFG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeConfigAndEnv', () => {
  it('writes both files on happy path', async () => {
    await writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { slack: { command: 'slack-mcp', env: { SLACK_TOKEN: '${SLACK_TOKEN}' } } },
    }, { SLACK_TOKEN: 'xoxb-abc' });

    const cfg = readFileSync(cfgPath, 'utf-8');
    expect(cfg).toContain('slack:');
    expect(cfg).toContain('SLACK_TOKEN: \${SLACK_TOKEN}');

    const env = readFileSync(envPath, 'utf-8');
    expect(env).toBe('SLACK_TOKEN=xoxb-abc\n');
  });

  it('rolls back when config validation fails (env stays unchanged)', async () => {
    writeFileSync(envPath, 'OLD=keep\n');

    await expect(writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { 'BAD KEY': { command: 'x' } },     // invalid slug
    }, { NEW: 'value' })).rejects.toThrow(ConfigValidationError);

    expect(readFileSync(envPath, 'utf-8')).toBe('OLD=keep\n');
  });

  it('rolls back when env validation fails (config stays unchanged)', async () => {
    const before = readFileSync(cfgPath, 'utf-8');

    await expect(writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { slack: { command: 'slack-mcp' } },
    }, { BAD_VAL: 'has\nnewline' })).rejects.toThrow();

    expect(readFileSync(cfgPath, 'utf-8')).toBe(before);
  });

  it('handles empty env kv (config-only write)', async () => {
    await writeConfigAndEnv(cfgPath, envPath, {
      mcp_servers: { slack: { command: 'slack-mcp' } },
    }, {});

    expect(readFileSync(cfgPath, 'utf-8')).toContain('slack:');
    expect(existsSync(envPath)).toBe(false);
  });

  it('serializes concurrent calls via the file lock', async () => {
    await Promise.all([
      writeConfigAndEnv(cfgPath, envPath, {
        mcp_servers: { slack: { command: 'slack-mcp', env: { SLACK_TOKEN: '${SLACK_TOKEN}' } } },
      }, { SLACK_TOKEN: 'a' }),
      writeConfigAndEnv(cfgPath, envPath, {
        mcp_servers: { ms365: { command: 'ms365-mcp' } },
      }, { MS365_CLIENT_ID: 'b' }),
    ]);

    const env = readFileSync(envPath, 'utf-8');
    expect(env).toMatch(/SLACK_TOKEN=a/);
    expect(env).toMatch(/MS365_CLIENT_ID=b/);
  });
});
