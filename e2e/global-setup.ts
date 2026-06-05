// e2e/global-setup.ts
//
// Cleanup teardown for the per-run XDG_CONFIG_HOME. The temp dir is
// created at config-load time in playwright.config.ts (see comments
// there for why config-load and not here). This hook only runs the
// final cleanup.
//
// Defensive: only delete paths under the system tmpdir().

import { rmSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  return async () => {
    const dir = process.env.SCRY_E2E_XDG_HOME;
    const sentinel = process.env.SCRY_E2E_SENTINEL;
    if (dir && dir.startsWith(tmpdir())) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    if (sentinel && sentinel.startsWith(tmpdir()) && existsSync(sentinel)) {
      try { unlinkSync(sentinel); } catch { /* ignore */ }
    }
  };
}

export default globalSetup;
