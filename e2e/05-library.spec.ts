// e2e/05-library.spec.ts
//
// Library sidebar — after wizard completes, the sidebar should be present.
// We don't strictly assert that 04-search's session row is visible because
// session persistence + sidebar refresh interactions are an internal detail
// covered by web/src/lib/sessions tests. This spec is a smoke check that
// the sidebar mounts.

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('Library sidebar mounts on home page', async ({ page }) => {
  await page.goto('/');
  // The sidebar contains a "Library" header per LibrarySidebar component.
  await expect(page.getByText(/Library/, { exact: false }).first()).toBeVisible();
});
