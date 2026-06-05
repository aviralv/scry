import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createServer } from './index.js';
import { generateCsrfToken } from './middleware/csrf-token.js';
import { resolveConfigPath } from '../config/loader.js';
import { loadDotEnvFile } from '../config/dotenv.js';
import { SessionsStore } from '../storage/sessions.js';
import { runOnboardingAutocomplete } from './migrations/onboarding-autocomplete.js';

export interface BootOptions {
  port: number;
}

/**
 * Start the server and resolve when it's actually listening on the port.
 * Rejects on EADDRINUSE or other listen failures so the CLI can surface a
 * structured error instead of crashing later.
 */
export async function startServer(opts: BootOptions): Promise<Server> {
  generateCsrfToken();
  const configPath = resolveConfigPath();
  // Log the resolved config path so a stale cwd-precedence config doesn't
  // silently shadow the XDG config without anyone noticing. Caught in the
  // wild during Plan E smoke; logging closes the surprise window.
  console.log(`scry: config = ${configPath}`);

  // Bootstrap an empty config for brand-new users so wizard endpoints
  // (which require existsSync(configPath)) don't 412-loop. The skeleton
  // intentionally omits an `llm:` block — the wizard derives Step 1 from
  // llm: null and PUT /api/llm populates it on first use.
  if (!existsSync(configPath)) {
    console.log(`scry: creating empty config at ${configPath}`);
    writeFileSync(configPath, 'mcp_servers: {}\nsearch_tools: {}\n', 'utf-8');
  }

  const configDir = dirname(configPath);

  // Load .scry.env once at boot so health-check spawns can resolve declared
  // ${REF} env values. runQuery loads it per-call too — idempotent so two
  // loads cause no harm; what we cannot tolerate is *not* loading it before
  // /api/mcps/:name/test runs.
  loadDotEnvFile(join(configDir, '.scry.env'));

  // One-time migration for pre-G configs (idempotent).
  await runOnboardingAutocomplete(configPath);

  const sessionsStore = new SessionsStore(join(configDir, 'scry.db'));

  // Close store cleanly on signal so WAL is checkpointed.
  const close = () => {
    try { sessionsStore.close(); } catch { /* idempotent */ }
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  const app = createServer({ port: opts.port, sessionsStore });
  return new Promise((resolveListening, reject) => {
    const server = serve(
      { fetch: app.fetch, port: opts.port, hostname: '127.0.0.1' },
      () => resolveListening(server as unknown as Server),
    );
    (server as unknown as Server).once('error', reject);
  });
}
