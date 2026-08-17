import { Hono } from 'hono';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';
import { buildSearchRouteWithConfig } from './routes/search.js';
import { buildSessionsRoute } from './routes/sessions.js';
import { buildMcpsRoute } from './routes/mcps.js';
import { buildRegistryRoute } from './routes/registry.js';
import { buildLlmRoute } from './routes/llm.js';
import { buildMcpsDiscoverRoute } from './routes/mcps-discover.js';
import { buildOnboardingRoute } from './routes/onboarding.js';
import { staticHandler } from './static.js';
import { resolveConfigPath } from '../config/loader.js';
import type { SessionsStore } from '../storage/sessions.js';

export interface ServerOptions {
  port: number;
  staticDir?: string;
  sessionsStore: SessionsStore;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(opts: ServerOptions) {
  const app = new Hono();

  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());

  // Resolve the config path ONCE at server creation. The previous
  // implementation re-resolved on every request, which was harmless but
  // surprising — it meant `SCRY_CONFIG` env changes between requests
  // would silently take effect. We resolve once now; restart `scry serve`
  // to change the config path.
  //
  const configPath = resolveConfigPath();
  const envPath = join(dirname(configPath), '.scry.env');

  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);
  app.route('/api/sessions', buildSessionsRoute(opts.sessionsStore));
  app.route('/api/search', buildSearchRouteWithConfig({ store: opts.sessionsStore, configPath }));
  app.route('/api/mcps', buildMcpsRoute({ configPath }));
  app.route('/api/registry', buildRegistryRoute({ configPath }));
  app.route('/api/llm', buildLlmRoute({ configPath, envPath }));
  app.route('/api/mcps/discover', buildMcpsDiscoverRoute({ configPath }));
  app.route('/api/onboarding', buildOnboardingRoute({ configPath, envPath }));

  const staticDir = opts.staticDir ?? resolve(__dirname, '../web');
  app.use('*', staticHandler(staticDir));

  return app;
}
