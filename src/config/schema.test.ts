import { describe, it, expect } from 'vitest';
import { McpServerConfigSchema, RegistrySchema, PersonSchema, ProjectSchema, McpServersMapSchema, LlmConfigSchema, OnboardingSchema } from './schema.js';

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

  it('accepts an empty registry block — both sub-keys default to {}', () => {
    const r = RegistrySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.people).toEqual({});
      expect(r.data.projects).toEqual({});
    }
  });

  it('accepts a registry with only people — projects defaults to {}', () => {
    const r = RegistrySchema.safeParse({
      people: { 'andre-c': { name: 'Andre', identifiers: {} } },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.projects).toEqual({});
  });
});

describe('McpServersMapSchema', () => {
  it('accepts a slug-keyed entry', () => {
    const r = McpServersMapSchema.safeParse({
      slack: { command: 'slack-mcp' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-slug keys', () => {
    const r = McpServersMapSchema.safeParse({
      'BAD KEY': { command: 'x' },
    });
    expect(r.success).toBe(false);
  });
});

describe('LlmConfigSchema', () => {
  it('accepts a config with all three fields', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'https://api.anthropic.com',
      auth_token: '${ANTHROPIC_API_KEY}',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a config without auth_token (proxy case)', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'http://localhost:6655/anthropic/',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-URL base_url', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'not-a-url',
      model: 'm',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty model', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'https://api.anthropic.com',
      model: '',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an auth_token that is neither ${REF} nor safe-literal', () => {
    const r = LlmConfigSchema.safeParse({
      base_url: 'https://api.anthropic.com',
      auth_token: 'has spaces',
      model: 'm',
    });
    expect(r.success).toBe(false);
  });
});

describe('OnboardingSchema', () => {
  it('defaults completed to false on empty input', () => {
    const r = OnboardingSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.completed).toBe(false);
  });

  it('accepts skip flags', () => {
    const r = OnboardingSchema.safeParse({
      completed: false,
      llm_skipped: true,
      mcps_skipped: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-boolean completed', () => {
    const r = OnboardingSchema.safeParse({ completed: 'yes' });
    expect(r.success).toBe(false);
  });
});
