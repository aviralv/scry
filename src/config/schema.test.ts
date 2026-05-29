import { describe, it, expect } from 'vitest';
import { McpServerConfigSchema, RegistrySchema, PersonSchema, ProjectSchema } from './schema.js';

describe('McpServerConfigSchema', () => {
  it('accepts a minimal valid entry', () => {
    const r = McpServerConfigSchema.safeParse({ command: 'slack-mcp' });
    expect(r.success).toBe(true);
  });

  it('accepts args + env-ref values', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'slack-mcp',
      args: ['--json'],
      env: { TOKEN: '${SLACK_TOKEN}' },
      enabled: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts safe-literal env values (forward slash allowed for path forwarding)', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'x',
      env: { BIN: '/usr/local/bin/x' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty command', () => {
    const r = McpServerConfigSchema.safeParse({ command: '' });
    expect(r.success).toBe(false);
  });

  it('rejects env values with shell metachars', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'x',
      env: { BAD: '$(whoami)' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects env-ref-shaped values that aren\'t fully bracketed', () => {
    const r = McpServerConfigSchema.safeParse({
      command: 'x',
      env: { BAD: 'prefix_${VAR}_suffix' },
    });
    expect(r.success).toBe(false);
  });
});

describe('PersonSchema', () => {
  it('accepts aliases and identifiers', () => {
    const r = PersonSchema.safeParse({
      name: 'Andre',
      aliases: ['andre', 'AC'],
      teams: ['LeanIX'],
      identifiers: { slack_username: 'andre', email: 'a@b.com' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing name', () => {
    expect(PersonSchema.safeParse({ identifiers: {} }).success).toBe(false);
  });

  it('rejects malformed email', () => {
    expect(
      PersonSchema.safeParse({ name: 'X', identifiers: { email: 'not-an-email' } }).success,
    ).toBe(false);
  });
});

describe('ProjectSchema', () => {
  it('accepts a minimal project', () => {
    const r = ProjectSchema.safeParse({ name: 'EA' });
    expect(r.success).toBe(true);
  });

  it('accepts routing fields', () => {
    const r = ProjectSchema.safeParse({
      name: 'EA',
      aliases: ['ea'],
      routing: { slack_channels: ['#ea'], jira_project: 'EA', confluence_cql: 'space=EA' },
    });
    expect(r.success).toBe(true);
  });
});

describe('RegistrySchema', () => {
  it('accepts a slug-keyed registry', () => {
    const r = RegistrySchema.safeParse({
      people: { 'andre-c': { name: 'Andre', identifiers: {} } },
      projects: { 'ea-2': { name: 'EA' } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-slug keys', () => {
    const r = RegistrySchema.safeParse({
      people: { 'Andre Christ': { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    expect(r.success).toBe(false);
  });
});
