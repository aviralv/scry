import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runOnboardingAutocomplete } from './onboarding-autocomplete.js';

let dir: string;
let cfgPath: string;

const SEED_LLM_AND_MCPS = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers:
  slack:
    command: slack-mcp
search_tools: {}
`;

const SEED_LLM_NO_MCPS = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers: {}
search_tools: {}
`;

const SEED_WITH_ONBOARDING_FALSE = `llm:
  base_url: https://api.anthropic.com
  auth_token: \${ANTHROPIC_API_KEY}
  model: claude-haiku-4-5-20251001
mcp_servers:
  slack:
    command: slack-mcp
search_tools: {}
onboarding:
  completed: false
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-migration-'));
  cfgPath = join(dir, 'scry.config.yaml');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runOnboardingAutocomplete', () => {
  it('writes completed:true when onboarding absent + llm + mcps non-empty', async () => {
    writeFileSync(cfgPath, SEED_LLM_AND_MCPS);
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('migrated');
    const out = readFileSync(cfgPath, 'utf-8');
    expect(out).toContain('onboarding:');
    expect(out).toMatch(/completed:\s*true/);
  });

  it('is a no-op when mcps is empty', async () => {
    writeFileSync(cfgPath, SEED_LLM_NO_MCPS);
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('skipped');
    expect(readFileSync(cfgPath, 'utf-8')).not.toContain('onboarding:');
  });

  it('is a no-op when onboarding block exists with completed:false', async () => {
    writeFileSync(cfgPath, SEED_WITH_ONBOARDING_FALSE);
    const before = readFileSync(cfgPath, 'utf-8');
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('skipped');
    expect(readFileSync(cfgPath, 'utf-8')).toBe(before);
  });

  it('is a no-op when config does not exist', async () => {
    expect(existsSync(cfgPath)).toBe(false);
    const r = await runOnboardingAutocomplete(cfgPath);
    expect(r).toBe('skipped');
  });

  it('is idempotent — running twice produces the same file as running once', async () => {
    writeFileSync(cfgPath, SEED_LLM_AND_MCPS);
    await runOnboardingAutocomplete(cfgPath);
    const after1 = readFileSync(cfgPath, 'utf-8');
    const r2 = await runOnboardingAutocomplete(cfgPath);
    expect(r2).toBe('skipped');
    expect(readFileSync(cfgPath, 'utf-8')).toBe(after1);
  });
});
