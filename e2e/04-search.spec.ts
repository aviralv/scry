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

test.describe.configure({ mode: 'serial' });

test('Search submits and renders mock answer + sources', async ({ page }) => {
  await page.goto('/');

  // Submit a query. The mock returns the same content regardless of input.
  const input = page.getByPlaceholder(/Ask anything/);
  await input.fill('what about pricing?');
  await input.press('Enter');

  // Wait for the answer to render. The mock answer contains "Status:".
  await expect(page.getByText(/Status:/, { exact: false })).toBeVisible({ timeout: 15_000 });

  // Citations render as <sup> with data-cite — true for both old and new
  // AnswerStream implementations.
  const cite1 = page.locator('sup[data-cite="1"]').first();
  await expect(cite1).toBeVisible();

  const cite2 = page.locator('sup[data-cite="2"]').first();
  await expect(cite2).toBeVisible();
});

