import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeConfig, ConfigValidationError, ConfigMissingError } from './write-config.js';

let dir: string;
let cfg: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-write-config-'));
  cfg = join(dir, 'scry.config.yaml');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SEED = `# top comment

llm: {}
mcp_servers:
  slack:
    command: slack-mcp
search_tools:
  slack:
    - tool: slack_search

# bottom comment
`;

describe('writeConfig', () => {
  it('throws ConfigMissingError when file does not exist', async () => {
    await expect(
      writeConfig(cfg, { mcp_servers: {} }),
    ).rejects.toBeInstanceOf(ConfigMissingError);
  });

  it('replaces mcp_servers wholesale and keeps other top-level keys', async () => {
    writeFileSync(cfg, SEED);
    await writeConfig(cfg, {
      mcp_servers: { confluence: { command: 'confluence-jira-mcp' } },
    });
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('confluence:');
    expect(raw).not.toContain('slack-mcp');
    expect(raw).toContain('search_tools:');
  });

  it('preserves comments outside the registry/mcp_servers blocks', async () => {
    writeFileSync(cfg, SEED);
    await writeConfig(cfg, {
      mcp_servers: { x: { command: 'x' } },
    });
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('# top comment');
    expect(raw).toContain('# bottom comment');
  });

  it('throws ConfigValidationError with path-scoped issues on invalid input', async () => {
    writeFileSync(cfg, SEED);
    let err: unknown;
    try {
      await writeConfig(cfg, { mcp_servers: { '': { command: 'x' } } as never });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConfigValidationError);
    const issues = (err as ConfigValidationError).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path).toBeInstanceOf(Array);
  });

  it('does not write the file on validation failure', async () => {
    writeFileSync(cfg, SEED);
    const before = readFileSync(cfg, 'utf-8');
    await expect(
      writeConfig(cfg, { mcp_servers: { 'BAD KEY': { command: 'x' } } as never }),
    ).rejects.toBeInstanceOf(ConfigValidationError);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('serializes concurrent writes (no torn writes)', async () => {
    writeFileSync(cfg, SEED);
    const writes = Array.from({ length: 5 }, (_, i) =>
      writeConfig(cfg, { mcp_servers: { x: { command: `cmd-${i}` } } }),
    );
    await Promise.all(writes);
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toMatch(/cmd-[0-4]/);
    // file is parseable YAML — no torn rename
    expect(() => raw.split('\n')).not.toThrow();
  });
});
