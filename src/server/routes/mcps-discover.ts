import { Hono } from 'hono';
import { existsSync } from 'fs';
import { BUNDLED_SERVERS } from '../../config/bundled-servers.js';
import { whichCommand } from '../../discovery/path-scan.js';

interface RouteDeps {
  configPath: string;
  which?: (cmd: string) => string | null;
}

export function buildMcpsDiscoverRoute(deps: RouteDeps): Hono {
  const which = deps.which ?? whichCommand;
  return new Hono()
    .get('/', (c) => {
      if (!existsSync(deps.configPath)) {
        return c.json({ error: 'config-required' }, 412);
      }
      const pathInstalled = BUNDLED_SERVERS
        .filter(s => which(s.command) !== null)
        .map(s => s.command);
      return c.json({ bundled: BUNDLED_SERVERS, pathInstalled });
    });
}
