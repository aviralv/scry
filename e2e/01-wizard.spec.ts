// e2e/01-wizard.spec.ts
//
// First-run flow. Resets the seeded config to fresh-install before this
// file's tests run (spec 01 is the only file that tests the wizard from
// scratch — the other specs use the seeded "completed" state from
// globalSetup).
//
// We exercise the skip path on both Step 1 (LLM) and Step 2 (MCPs) — that's
// the realistic E2E path because we have no real Anthropic backend or MCP
// servers to test against in CI.

import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';

test.describe.configure({ mode: 'serial' });

const FRESH_CONFIG = `llm: {}
mcp_servers: {}
search_tools: {}
`;

const SEED_CONFIG = `llm: {}
mcp_servers: {}
search_tools: {}
onboarding:
  completed: true
  llm_skipped: true
  mcps_skipped: true
`;

function configPath(): string {
  const xdgHome = process.env.SCRY_E2E_XDG_HOME;
  if (!xdgHome) {
    throw new Error('SCRY_E2E_XDG_HOME not set — globalSetup did not run?');
  }
  return join(xdgHome, 'scry', 'scry.config.yaml');
}

test.beforeAll(() => {
  // Reset to fresh-install. The three tests below progressively walk the
  // wizard; the file ends in "completed" state, but `afterAll` restores the
  // seed shape so the next spec file's beforeAll has a clean baseline even
  // if its own setup misfires.
  writeFileSync(configPath(), FRESH_CONFIG, 'utf-8');
});

test.afterAll(() => {
  writeFileSync(configPath(), SEED_CONFIG, 'utf-8');
});

test('wizard redirects fresh install to /onboarding', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: /Step 1.*Connect to your LLM/i })).toBeVisible();
});

test('Step 1: skip LLM advances to Step 2', async ({ page }) => {
  await page.goto('/onboarding');

  page.once('dialog', (d) => d.accept());

  await page.getByRole('button', { name: /Skip — searches will fail/ }).click();

  await expect(page.getByRole('heading', { name: /Step 2.*Pick the search sources/i })).toBeVisible();
});

test('Step 2: skip MCPs finishes wizard and lands on Search', async ({ page }) => {
  await page.goto('/onboarding?step=2');

  page.once('dialog', (d) => d.accept());

  await page.getByRole('button', { name: /I'll configure MCPs later/ }).click();

  await expect(page.getByRole('heading', { name: /Confirm/i })).toBeVisible();
  // Match exact button text — "Confirm & finish" matches the rail step too.
  await page.getByRole('button', { name: 'Finalize & start searching' }).click();

  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/?$/, { timeout: 10_000 });
  await expect(page.getByRole('heading')).toBeVisible();
});
