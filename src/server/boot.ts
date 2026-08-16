import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createServer } from './index.js';
import { generateCsrfToken } from './middleware/csrf-token.js';
import { resolveConfigPath } from '../config/loader.js';
import { loadDotEnvFile } from '../config/dotenv.js';
import { SessionsStore } from '../storage/sessions.js';
import { runOnboardingAutocomplete } from './migrations/onboarding-autocomplete.js';
import { log } from './logger.js';

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
  log.info(`config = ${configPath}`);

  // Bootstrap an empty config for brand-new users so wizard endpoints
  // (which require existsSync(configPath)) don't 412-loop. The skeleton
  // includes `llm: {}` so loadConfig produces a typed-shape object instead
  // of undefined — any code path that accesses config.llm.* won't TypeError
  // on users who open the wizard, close without completing Step 1, then run
  // e.g. `scry search`. The wizard's GET /api/onboarding already treats
  // llm: {} the same as absent (both yield llm: null in the response).
  if (!existsSync(configPath)) {
    log.info(`creating empty config at ${configPath}`);
    // Ensure the parent directory exists. With a fresh XDG_CONFIG_HOME
    // (or first-ever scry boot on a clean machine), `~/.config/scry/`
    // doesn't exist yet — writeFileSync would ENOENT without this.
    //
    // Wrap mkdirSync + writeFileSync in try/catch: on EACCES (read-only
    // mounts, root-owned dirs in Docker, locked-down enterprise machines)
    // an unhandled throw crashes the server with a stack trace that
    // doesn't tell the user what went wrong. Surface a clean error and
    // exit deliberately.
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n', 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const reason =
        code === 'EACCES' ? 'permission denied' :
        code === 'EROFS' ? 'read-only filesystem' :
        code === 'ENOENT' ? 'parent directory does not exist' :
        (err as Error).message;
      log.error(
        `scry: cannot create config at ${configPath}: ${reason}.\n` +
          `       Set XDG_CONFIG_HOME to a writable directory, or use SCRY_CONFIG to point at an existing config.`,
      );
      throw new Error(`scry boot: config bootstrap failed (${reason})`);
    }
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
