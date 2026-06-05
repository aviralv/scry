// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = Number(process.env.PORT ?? 4321);
const BASE_URL = `http://localhost:${PORT}`;

// Per-run isolated config dir. Created at config load (once per `npm run
// test:e2e`) so the path is known when webServer.env is built. Cleanup is
// best-effort in e2e/global-setup.ts's teardown — leaking is harmless
// (under /tmp, will be reaped) and we'd rather not silently delete
// scry data if a stale dir somehow survives.
const XDG_HOME = mkdtempSync(join(tmpdir(), 'scry-e2e-'));
process.env.SCRY_E2E_XDG_HOME = XDG_HOME;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,           // single-port webServer; serialize specs
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node dist/cli/index.js serve --port ${PORT}`,
    url: BASE_URL,
    // Always start a fresh server: a reused server may have an old config
    // committed onto it (onboarding completed, sessions DB populated) and
    // the wizard spec would not see fresh-install state.
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      XDG_CONFIG_HOME: XDG_HOME,
      SCRY_SEARCH_MOCK: '1',
    },
  },
  globalSetup: './e2e/global-setup.ts',
});
