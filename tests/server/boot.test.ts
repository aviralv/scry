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
  it('creates an empty config with llm: {} when none exists', async () => {
    const cfg = process.env.SCRY_CONFIG!;
    expect(existsSync(cfg)).toBe(false);
    const server = await startServer({ port: 0 });
    expect(existsSync(cfg)).toBe(true);
    const content = readFileSync(cfg, 'utf-8');
    expect(content).toContain('mcp_servers');
    expect(content).toContain('llm');
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

  it('runs onboarding-autocomplete migration on a config with llm + mcp_servers but no onboarding block', async () => {
    // Pre-G users have hand-edited or scry-init-generated configs that
    // never went through the wizard. boot's migration should mark them
    // complete so the wizard doesn't hijack them. Locks the boot path
    // (not just the migration function in isolation).
    const cfg = process.env.SCRY_CONFIG!;
    writeFileSync(
      cfg,
      [
        'llm:',
        '  base_url: https://api.anthropic.com',
        '  model: m',
        'mcp_servers:',
        '  slack:',
        '    command: slack-mcp',
        'search_tools: {}',
        '',
      ].join('\n'),
    );
    const server = await startServer({ port: 0 });
    const after = readFileSync(cfg, 'utf-8');
    expect(after).toContain('onboarding:');
    expect(after).toContain('completed: true');
    server.close();
  });

  it('does NOT migrate a config that has an existing onboarding block', async () => {
    // Hand-edited "onboarding: completed: false" must not be silently
    // overwritten — the user is intentionally opting back into the wizard.
    const cfg = process.env.SCRY_CONFIG!;
    const original = [
      'llm:',
      '  base_url: https://api.anthropic.com',
      '  model: m',
      'mcp_servers:',
      '  slack:',
      '    command: slack-mcp',
      'search_tools: {}',
      'onboarding:',
      '  completed: false',
      '',
    ].join('\n');
    writeFileSync(cfg, original);
    const server = await startServer({ port: 0 });
    expect(readFileSync(cfg, 'utf-8')).toBe(original);
    server.close();
  });
});
