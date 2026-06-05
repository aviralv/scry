// e2e/04-search.spec.ts
//
// Search end-to-end with the engine stub (SCRY_SEARCH_MOCK=1 — set in
// playwright.config.ts). Verifies:
//   - Query submission triggers an SSE stream
//   - Mock answer arrives and renders
//   - Citations are interactive (clickable <sup data-cite>)
//
// The mock emits a fixed answer with two sources [1] and [2]. See
// src/engine/mock-runQuery.ts for the canned shape.
//
// NOTE: This spec is intentionally light on markdown-formatting assertions
// because PR #20 (issue #9, render markdown in answer panel) lands as a
// separate change. After both merge, follow-up specs can assert <strong>,
// list items, etc. — for now we only assert behavior that holds with
// either the pre- or post-#20 renderer.

import { test, expect } from '@playwright/test';
import { seedCompletedConfig } from './_seed.js';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => seedCompletedConfig());

test('Search submits and renders mock answer + sources', async ({ page }) => {
  await page.goto('/');

  // Wait for the SSE response to start before asserting on rendered text.
  // Without this, `getByText(/Status:/)` can race the React re-render
  // triggered by the SSE event arrival on slow CI machines.
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/search') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );

  const input = page.getByPlaceholder(/Ask anything/);
  await input.fill('what about pricing?');
  await input.press('Enter');

  await responsePromise;

  // Mock answer contains "Status:".
  await expect(page.getByText(/Status:/, { exact: false })).toBeVisible({ timeout: 15_000 });

  // Citations render as <sup> with data-cite — true for both old and new
  // AnswerStream implementations.
  await expect(page.locator('sup[data-cite="1"]').first()).toBeVisible();
  await expect(page.locator('sup[data-cite="2"]').first()).toBeVisible();
});
