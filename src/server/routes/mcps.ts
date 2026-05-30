import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { McpServerConfigSchema } from '../../config/schema.js';
import { writeConfig, ConfigValidationError } from '../../config/write-config.js';
import { healthCheck as realHealthCheck, type HealthCheckResult } from '../mcp-health.js';
import type { McpServerConfig } from '../../config/types.js';
import { zodToApiErrors } from '../../shared/api-errors.js';

const NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const PostBodySchema = z.object({
  name: z.string().regex(NAME_RE),
}).and(McpServerConfigSchema);

const PatchBodySchema = McpServerConfigSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'patch body must contain at least one field' },
);

interface RouteDeps {
  configPath: () => string;
  healthCheck?: (server: McpServerConfig, opts?: { timeoutMs?: number }) => Promise<HealthCheckResult>;
}

interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

function loadServers(configPath: string): Record<string, McpServerConfig> | null {
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw) as { mcp_servers?: Record<string, McpServerConfig> } | undefined;
  return parsed?.mcp_servers ?? {};
}

function toEntry(name: string, cfg: McpServerConfig): McpServerEntry {
  return { name, command: cfg.command, args: cfg.args, env: cfg.env, enabled: cfg.enabled ?? true };
}

export function buildMcpsRoute(deps: RouteDeps): Hono {
  const healthCheck = deps.healthCheck ?? realHealthCheck;

  return new Hono()
    .get('/', (c) => {
      const servers = loadServers(deps.configPath());
      if (servers === null) return c.json({ error: 'config-required', message: 'scry.config.yaml does not exist' }, 412);
      const entries = Object.entries(servers).map(([n, s]) => toEntry(n, s));
      return c.json({ servers: entries });
    })

    .post('/', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PostBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues as { path: (string | number)[]; message: string }[]) }, 400);
      }
      const { name, ...serverCfg } = parsed.data;
      if (servers[name]) return c.json({ error: 'name-exists', message: `MCP "${name}" already exists` }, 409);

      const hc = await healthCheck(serverCfg);
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      try {
        await writeConfig(cfgPath, { mcp_servers: { ...servers, [name]: serverCfg } });
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        }
        throw err;
      }
      return c.json({ server: toEntry(name, serverCfg) }, 201);
    })

    .patch('/:name', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);
      const name = c.req.param('name');
      const existing = servers[name];
      if (!existing) return c.json({ error: 'not-found' }, 404);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PatchBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues as { path: (string | number)[]; message: string }[]) }, 400);
      }
      const merged: McpServerConfig = { ...existing, ...parsed.data };

      const hc = await healthCheck(merged);
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      try {
        await writeConfig(cfgPath, { mcp_servers: { ...servers, [name]: merged } });
      } catch (err) {
        if (err instanceof ConfigValidationError) return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        throw err;
      }
      return c.json({ server: toEntry(name, merged) });
    })

    .delete('/:name', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);
      const name = c.req.param('name');
      // Idempotent: 204 even if missing.
      if (!servers[name]) return c.body(null, 204);
      const next = { ...servers };
      delete next[name];
      try {
        await writeConfig(cfgPath, { mcp_servers: next });
      } catch (err) {
        if (err instanceof ConfigValidationError) return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        throw err;
      }
      return c.body(null, 204);
    })

    .post('/:name/test', async (c) => {
      const cfgPath = deps.configPath();
      const servers = loadServers(cfgPath);
      if (servers === null) return c.json({ error: 'config-required' }, 412);
      const name = c.req.param('name');
      const existing = servers[name];
      if (!existing) return c.json({ error: 'not-found' }, 404);
      const hc = await healthCheck(existing);
      return c.json(hc);
    });
}
