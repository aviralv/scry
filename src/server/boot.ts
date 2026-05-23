import { serve } from '@hono/node-server';
import { createServer } from './index.js';
import { generateCsrfToken } from './middleware/csrf-token.js';

export interface BootOptions {
  port: number;
}

export function startServer(opts: BootOptions) {
  generateCsrfToken();
  const app = createServer(opts);
  return serve({ fetch: app.fetch, port: opts.port, hostname: '127.0.0.1' });
}
