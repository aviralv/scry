import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeConfig, writeConfigDoc, ConfigValidationError, ConfigMissingError } from './write-config.js';

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
      writeConfig(cfg, () => ({ mcp_servers: {} })),
    ).rejects.toBeInstanceOf(ConfigMissingError);
  });

  it('replaces mcp_servers wholesale and keeps other top-level keys', async () => {
    writeFileSync(cfg, SEED);
    await writeConfig(cfg, () => ({
      mcp_servers: { confluence: { command: 'confluence-jira-mcp' } },
    }));
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('confluence:');
    expect(raw).not.toContain('slack-mcp');
    expect(raw).toContain('search_tools:');
  });

  it('preserves comments outside the registry/mcp_servers blocks', async () => {
    writeFileSync(cfg, SEED);
    await writeConfig(cfg, () => ({
      mcp_servers: { x: { command: 'x' } },
    }));
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('# top comment');
    expect(raw).toContain('# bottom comment');
  });

  it('throws ConfigValidationError with path-scoped issues on invalid input', async () => {
    writeFileSync(cfg, SEED);
    let err: unknown;
    try {
      await writeConfig(cfg, () => ({ mcp_servers: { '': { command: 'x' } } as never }));
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
      writeConfig(cfg, () => ({ mcp_servers: { 'BAD KEY': { command: 'x' } } as never })),
    ).rejects.toBeInstanceOf(ConfigValidationError);
    expect(readFileSync(cfg, 'utf-8')).toBe(before);
  });

  it('serializes concurrent writes and preserves both updates (read-modify-write)', async () => {
    writeFileSync(cfg, SEED);
    // Each callback reads the current state and adds one server.
    // With the merge-callback approach, both servers should end up in config
    // because each callback operates on the freshly-written state.
    const writes = Array.from({ length: 5 }, (_, i) =>
      writeConfig(cfg, (current) => ({
        mcp_servers: { ...(current.mcp_servers ?? {}), [`server${i}`]: { command: `cmd-${i}` } },
      })),
    );
    await Promise.all(writes);
    const raw = readFileSync(cfg, 'utf-8');
    // All 5 servers must be present — proves the lock + read-modify-write is atomic.
    for (let i = 0; i < 5; i++) {
      expect(raw).toContain(`server${i}:`);
    }
    // File is valid YAML after the lock-serialized writes — proves no
    // partial-write artifacts (which atomicWriteConfig also guarantees on
    // its own; this assertion catches regressions in either layer).
    const { parse } = await import('yaml');
    expect(() => parse(raw)).not.toThrow();
    expect(parse(raw)).toBeTruthy();
  });
});

describe('writeConfigDoc', () => {
  it('throws ConfigMissingError when file does not exist', async () => {
    await expect(
      writeConfigDoc(cfg, () => {}),
    ).rejects.toBeInstanceOf(ConfigMissingError);
  });

  it('happy path: mutator runs and file is updated', async () => {
    writeFileSync(cfg, SEED);
    await writeConfigDoc(cfg, (doc) => {
      doc.set('onboarding', { completed: true });
    });
    const { parse } = await import('yaml');
    const result = parse(readFileSync(cfg, 'utf-8'));
    expect(result.onboarding).toEqual({ completed: true });
    // Other keys preserved
    expect(result.llm).toBeDefined();
    expect(result.mcp_servers).toBeDefined();
  });

  it('throws on YAML parse error with informative message', async () => {
    writeFileSync(cfg, 'key: : bad: yaml: :::');
    await expect(
      writeConfigDoc(cfg, () => {}),
    ).rejects.toThrow(/YAML syntax errors/);
  });

  it('propagates mutator errors and releases the lock', async () => {
    writeFileSync(cfg, SEED);
    const before = readFileSync(cfg, 'utf-8');
    await expect(
      writeConfigDoc(cfg, () => {
        throw new Error('mutator-exploded');
      }),
    ).rejects.toThrow('mutator-exploded');
    // Lock must be released — a second writeConfigDoc must succeed.
    await writeConfigDoc(cfg, (doc) => { doc.set('onboarding', { completed: false }); });
    expect(readFileSync(cfg, 'utf-8')).not.toBe(before);
  });

  it('serializes concurrent callers: 5 mutators each appending to mcp_servers all persist', async () => {
    writeFileSync(cfg, SEED);
    const writes = Array.from({ length: 5 }, (_, i) =>
      writeConfigDoc(cfg, (doc) => {
        const current = (doc.toJSON() ?? {}) as { mcp_servers?: Record<string, unknown> };
        const updated = { ...(current.mcp_servers ?? {}), [`server${i}`]: { command: `cmd-${i}` } };
        doc.set('mcp_servers', updated);
      }),
    );
    await Promise.all(writes);
    const raw = readFileSync(cfg, 'utf-8');
    for (let i = 0; i < 5; i++) {
      expect(raw).toContain(`server${i}:`);
    }
    const { parse } = await import('yaml');
    expect(() => parse(raw)).not.toThrow();
  });
});
