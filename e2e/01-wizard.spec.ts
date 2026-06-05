// e2e/01-wizard.spec.ts
//
// First-run flow. The Playwright global setup creates a fresh
// XDG_CONFIG_HOME, so the server boot writes an empty skeleton config and
// the wizard takes over. We exercise the skip path on both Step 1 (LLM)
// and Step 2 (MCPs) — that's the realistic E2E path because we have no
// real Anthropic backend or MCP servers to test against in CI.
//
// After this spec runs, the config is in a "completed but skipped"
// state which the other specs reuse.

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('wizard redirects fresh install to /onboarding', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: /Step 1.*Connect to your LLM/i })).toBeVisible();
});

test('Step 1: skip LLM advances to Step 2', async ({ page }) => {
  await page.goto('/onboarding');

  // Confirm dialog → accept.
  page.once('dialog', (d) => d.accept());

  await page.getByRole('button', { name: /Skip — searches will fail/ }).click();

  await expect(page.getByRole('heading', { name: /Step 2.*Pick the search sources/i })).toBeVisible();
});

test('Step 2: skip MCPs finishes wizard and lands on Search', async ({ page }) => {
  await page.goto('/onboarding?step=2');

  page.once('dialog', (d) => d.accept());

  await page.getByRole('button', { name: /I'll configure MCPs later/ }).click();

  // Step 3 (Confirm) is auto-derived; finalize.
  await expect(page.getByRole('heading', { name: /Confirm/i })).toBeVisible();
  // Match the exact button text — "Confirm & finish" matches the rail step
  // button too; we want the action button.
  await page.getByRole('button', { name: 'Finalize & start searching' }).click();

  // Lands on Search (home).
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/?$/, { timeout: 10_000 });
  await expect(page.getByRole('heading')).toBeVisible();
});
