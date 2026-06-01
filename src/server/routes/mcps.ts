import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { McpServerConfigSchema, McpServersMapSchema } from '../../config/schema.js';
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

type LoadResult =
  | { kind: 'ok'; servers: Record<string, McpServerConfig> }
  | { kind: 'missing' }
  | { kind: 'malformed'; detail: string };

function loadServers(configPath: string): LoadResult {
  if (!existsSync(configPath)) return { kind: 'missing' };
  let parsed: unknown;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    parsed = parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'malformed', detail: `failed to read or parse config: ${msg}` };
  }
  if (parsed == null) return { kind: 'ok', servers: {} };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'malformed', detail: 'config root must be a YAML mapping' };
  }
  const block = (parsed as { mcp_servers?: unknown }).mcp_servers;
  if (block === undefined) return { kind: 'ok', servers: {} };
  const validated = McpServersMapSchema.safeParse(block);
  if (!validated.success) {
    const detail = zodToApiErrors(validated.error.issues)
      .map(e => `${['mcp_servers', ...e.path].join('.')}: ${e.message}`)
      .join('; ');
    return { kind: 'malformed', detail: `mcp_servers block is invalid: ${detail}` };
  }
  return { kind: 'ok', servers: validated.data };
}

function toEntry(name: string, cfg: McpServerConfig): McpServerEntry {
  return { name, command: cfg.command, args: cfg.args, env: cfg.env, enabled: cfg.enabled ?? true };
}

export function buildMcpsRoute(deps: RouteDeps): Hono {
  const healthCheck = deps.healthCheck ?? realHealthCheck;

  return new Hono()
    .get('/', (c) => {
      const r = loadServers(deps.configPath());
      if (r.kind === 'missing') return c.json({ error: 'config-required', message: 'scry.config.yaml does not exist' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const entries = Object.entries(r.servers).map(([n, s]) => toEntry(n, s));
      return c.json({ servers: entries });
    })

    .post('/', async (c) => {
      const cfgPath = deps.configPath();
      const r = loadServers(cfgPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const servers = r.servers;

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PostBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
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
      const r = loadServers(cfgPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const servers = r.servers;
      const name = c.req.param('name');
      const existing = servers[name];
      if (!existing) return c.json({ error: 'not-found' }, 404);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PatchBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
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
      const r = loadServers(cfgPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const servers = r.servers;
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
      const r = loadServers(cfgPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const name = c.req.param('name');
      const existing = r.servers[name];
      if (!existing) return c.json({ error: 'not-found' }, 404);
      const hc = await healthCheck(existing);
      return c.json(hc);
    });
}
