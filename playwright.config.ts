// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = Number(process.env.PORT ?? 4321);
const BASE_URL = `http://localhost:${PORT}`;

// Per-run isolated config dir.
//
// Playwright imports this config file from multiple processes (the runner,
// each worker, the webServer's parent), which means top-level code runs
// more than once per `npm run test:e2e`. A naive `mkdtempSync` here would
// produce a DIFFERENT directory in every import, so the test process and
// the spawned server would end up looking at different filesystems.
//
// Fix: use a stable per-cwd sentinel file. The first process to load this
// config writes its temp-dir path; later imports from the same project
// directory read it back. The first sentinel write is non-atomic but the
// race window is tiny (Playwright sequences runner-init and server spawn);
// we take the first writer and ignore later ones via existsSync.
const SENTINEL = join(
  tmpdir(),
  `scry-e2e-${Buffer.from(process.cwd()).toString('hex').slice(-12)}.path`,
);

function ensureXdgHome(): string {
  if (existsSync(SENTINEL)) {
    const existing = readFileSync(SENTINEL, 'utf-8').trim();
    if (existing && existsSync(existing)) return existing;
  }
  const dir = mkdtempSync(join(tmpdir(), 'scry-e2e-'));
  const scryDir = join(dir, 'scry');
  mkdirSync(scryDir, { recursive: true });
  writeFileSync(
    join(scryDir, 'scry.config.yaml'),
    [
      'llm: {}',
      'mcp_servers: {}',
      'search_tools: {}',
      'onboarding:',
      '  completed: true',
      '  llm_skipped: true',
      '  mcps_skipped: true',
      '',
    ].join('\n'),
    'utf-8',
  );
  writeFileSync(SENTINEL, dir, 'utf-8');
  return dir;
}

const XDG_HOME = ensureXdgHome();
process.env.SCRY_E2E_XDG_HOME = XDG_HOME;
process.env.SCRY_E2E_SENTINEL = SENTINEL;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
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
    command: `node dist/cli/index.js serve --port ${PORT} --no-open`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      XDG_CONFIG_HOME: XDG_HOME,
      SCRY_SEARCH_MOCK: '1',
      // Suppress any developer-shell SCRY_CONFIG override.
      SCRY_CONFIG: '',
    },
  },
  globalSetup: './e2e/global-setup.ts',
});
