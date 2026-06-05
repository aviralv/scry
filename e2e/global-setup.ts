// e2e/global-setup.ts
//
// Cleanup teardown for the per-run XDG_CONFIG_HOME created in
// playwright.config.ts. Best-effort — leaking under /tmp is harmless
// and we'd rather not delete real scry data if SCRY_E2E_XDG_HOME
// somehow points outside /tmp.

import { rmSync } from 'fs';
import { tmpdir } from 'os';
import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  return async () => {
    const dir = process.env.SCRY_E2E_XDG_HOME;
    if (!dir) return;
    // Defense: only remove if under the system tmpdir.
    if (!dir.startsWith(tmpdir())) return;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  };
}

export default globalSetup;
