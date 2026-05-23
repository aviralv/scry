import { Hono } from 'hono';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';
import { staticHandler } from './static.js';

export interface ServerOptions {
  port: number;
  staticDir?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(opts: ServerOptions) {
  const app = new Hono();

  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());

  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);

  const staticDir = opts.staticDir ?? resolve(__dirname, '../web');
  app.use('*', staticHandler(staticDir));

  return app;
}
