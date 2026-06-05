// e2e/02-mcp-manager.spec.ts
//
// MCP manager surface — list bundled servers, add a custom one, drop it.
// Doesn't depend on spec 01: its beforeAll seeds the "completed" state
// directly so this file is self-contained.

import { test, expect } from '@playwright/test';
import { seedCompletedConfig } from './_seed.js';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => seedCompletedConfig());

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
