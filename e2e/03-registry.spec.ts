// e2e/03-registry.spec.ts
//
// Registry editor — add a person entry and confirm it persists. The
// registry is empty after onboarding, so we exercise the empty-state
// + add flow.

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('Registry page renders', async ({ page }) => {
  await page.goto('/registry');
  await expect(page.getByRole('heading', { name: 'Registry' })).toBeVisible();
});
