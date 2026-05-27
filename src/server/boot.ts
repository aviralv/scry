import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { dirname, join } from 'path';
import { createServer } from './index.js';
import { generateCsrfToken } from './middleware/csrf-token.js';
import { resolveConfigPath } from '../config/loader.js';
import { SessionsStore } from '../storage/sessions.js';

export interface BootOptions {
  port: number;
}

/**
 * Start the server and resolve when it's actually listening on the port.
 * Rejects on EADDRINUSE or other listen failures so the CLI can surface a
 * structured error instead of crashing later.
 */
export function startServer(opts: BootOptions): Promise<Server> {
  generateCsrfToken();
  const configDir = dirname(resolveConfigPath());
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
