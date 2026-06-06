import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { McpServerConfigSchema, McpServersMapSchema } from '../../config/schema.js';
import { writeConfig, ConfigValidationError, ConfigNameExistsError, ConfigNotFoundError } from '../../config/write-config.js';
import { healthCheck as realHealthCheck, type HealthCheckResult } from '../mcp-health.js';
import type { McpServerConfig } from '../../config/types.js';
import { toMcpEntry } from '../../shared/mcp-entry.js';
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
  configPath: string;
  healthCheck?: (server: McpServerConfig, opts?: { timeoutMs?: number }) => Promise<HealthCheckResult>;
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

export function buildMcpsRoute(deps: RouteDeps): Hono {
  const healthCheck = deps.healthCheck ?? realHealthCheck;

  return new Hono()
    .get('/', (c) => {
      const r = loadServers(deps.configPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required', message: 'scry.config.yaml does not exist' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const entries = Object.entries(r.servers).map(([n, s]) => toMcpEntry(n, s));
      return c.json({ servers: entries });
    })

    .post('/', async (c) => {
      const cfgPath = deps.configPath;
      // Fast-path checks outside the lock: existence (412) and malformed (500).
      const r = loadServers(cfgPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PostBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const { name, ...serverCfg } = parsed.data;

      // Optimistic 409 (fast path, no lock acquisition for obvious duplicates).
      if (r.servers[name]) return c.json({ error: 'name-exists', message: `MCP "${name}" already exists` }, 409);

      // Health check outside the lock — it's expensive and shouldn't hold it.
      const hc = await healthCheck(serverCfg, { timeoutMs: 15_000 });
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      try {
        await writeConfig(cfgPath, (current) => {
          const existing = current.mcp_servers ?? {};
          if (existing[name]) {
            // Authoritative 409: re-checked inside the lock — concurrent caller beat us.
            throw new ConfigNameExistsError(name);
          }
          return { mcp_servers: { ...existing, [name]: serverCfg } };
        });
      } catch (err) {
        if (err instanceof ConfigNameExistsError) {
          return c.json({ error: 'name-exists', message: `MCP "${err.mcpName}" already exists` }, 409);
        }
        if (err instanceof ConfigValidationError) {
          return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        }
        throw err;
      }
      return c.json({ server: toMcpEntry(name, serverCfg) }, 201);
    })

    .patch('/:name', async (c) => {
      const cfgPath = deps.configPath;
      const r = loadServers(cfgPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const name = c.req.param('name');

      // Optimistic 404 outside the lock (fast path).
      if (!r.servers[name]) return c.json({ error: 'not-found' }, 404);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = PatchBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const patch = parsed.data;

      // Health check outside the lock — merge with optimistic snapshot for the
      // health check. The authoritative merge happens inside the lock below.
      const optimisticMerged: McpServerConfig = { ...r.servers[name], ...patch };
      const hc = await healthCheck(optimisticMerged, { timeoutMs: 15_000 });
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      let finalMerged: McpServerConfig = optimisticMerged;
      try {
        await writeConfig(cfgPath, (current) => {
          const existing = current.mcp_servers ?? {};
          const entry = existing[name];
          if (!entry) {
            // Concurrent DELETE beat us — treat as not-found.
            throw new ConfigNotFoundError('MCP', name);
          }
          finalMerged = { ...entry, ...patch };
          return { mcp_servers: { ...existing, [name]: finalMerged } };
        });
      } catch (err) {
        if (err instanceof ConfigNotFoundError) {
          return c.json({ error: 'not-found' }, 404);
        }
        if (err instanceof ConfigValidationError) return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        throw err;
      }
      return c.json({ server: toMcpEntry(name, finalMerged) });
    })

    .delete('/:name', async (c) => {
      const cfgPath = deps.configPath;
      const r = loadServers(cfgPath);
      if (r.kind === 'missing') return c.json({ error: 'config-required' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      const name = c.req.param('name');
      // Idempotent fast-path: 204 even if missing (no lock needed).
      if (!r.servers[name]) return c.body(null, 204);
      try {
        await writeConfig(cfgPath, (current) => {
          const existing = { ...(current.mcp_servers ?? {}) };
          delete existing[name];
          return { mcp_servers: existing };
        });
      } catch (err) {
        if (err instanceof ConfigValidationError) return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        throw err;
      }
      return c.body(null, 204);
    })

    .post('/:name/test', async (c) => {
      const cfgPath = deps.configPath;
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
