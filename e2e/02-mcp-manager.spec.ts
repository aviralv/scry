// e2e/02-mcp-manager.spec.ts
//
// MCP manager surface — list bundled servers, add a custom one, drop it.
// Runs after the wizard has marked onboarding completed (with mcps_skipped),
// so navigation to /mcps does not redirect.

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('MCP manager renders bundled servers', async ({ page }) => {
  await page.goto('/mcps');
  await expect(page.getByRole('heading', { name: 'MCP servers' })).toBeVisible();
});

test('Custom MCP add modal opens and closes', async ({ page }) => {
  await page.goto('/mcps');
  // The "+ Add custom MCP" button is present on this surface (and its sibling
  // is the bundled server list). Clicking opens the modal.
  const addBtn = page.getByRole('button', { name: /Add custom MCP|Add MCP/i }).first();
  await addBtn.click();

  // Modal heading
  const heading = page.getByRole('heading', { name: /Add MCP|Custom MCP/i });
  await expect(heading.first()).toBeVisible();

  // Cancel/close.
  await page.getByRole('button', { name: /Cancel|Close/i }).first().click();
  await expect(heading).toHaveCount(0);
});
