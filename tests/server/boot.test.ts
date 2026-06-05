import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startServer } from '../../src/server/boot.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-boot-'));
  process.env.SCRY_CONFIG = join(dir, 'scry.config.yaml');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SCRY_CONFIG;
});

describe('startServer', () => {
  it('creates an empty config when none exists', async () => {
    const cfg = process.env.SCRY_CONFIG!;
    expect(existsSync(cfg)).toBe(false);
    const server = await startServer({ port: 0 });
    expect(existsSync(cfg)).toBe(true);
    expect(readFileSync(cfg, 'utf-8')).toContain('mcp_servers');
    server.close();
  });

  it('preserves an existing config (no overwrite)', async () => {
    const cfg = process.env.SCRY_CONFIG!;
    const existingContent = 'llm:\n  base_url: https://api.anthropic.com\n  model: m\nmcp_servers: {}\nsearch_tools: {}\n';
    writeFileSync(cfg, existingContent);
    const server = await startServer({ port: 0 });
    expect(readFileSync(cfg, 'utf-8')).toBe(existingContent);
    server.close();
  });
});
