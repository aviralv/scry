import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { RegistrySchema } from '../../config/schema.js';
import { writeConfig, ConfigValidationError } from '../../config/write-config.js';
import { zodToApiErrors } from '../../shared/api-errors.js';
import type { Registry } from '../../config/types.js';

const PutBodySchema = z.object({
  registry: RegistrySchema,
});

interface RouteDeps {
  configPath: () => string;
}

const EMPTY_REGISTRY: Registry = { people: {}, projects: {} };

type LoadResult =
  | { kind: 'ok'; registry: Registry }
  | { kind: 'missing' }
  | { kind: 'malformed'; detail: string };

function loadRegistry(configPath: string): LoadResult {
  if (!existsSync(configPath)) return { kind: 'missing' };
  let parsed: unknown;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    parsed = parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'malformed', detail: `failed to read or parse config: ${msg}` };
  }
  if (parsed == null) return { kind: 'ok', registry: EMPTY_REGISTRY };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'malformed', detail: 'config root must be a YAML mapping' };
  }
  const block = (parsed as { registry?: unknown }).registry;
  if (block === undefined) return { kind: 'ok', registry: EMPTY_REGISTRY };
  const validated = RegistrySchema.safeParse(block);
  if (!validated.success) {
    const detail = zodToApiErrors(validated.error.issues)
      .map(e => `${['registry', ...e.path].join('.')}: ${e.message}`)
      .join('; ');
    return { kind: 'malformed', detail: `registry block is invalid: ${detail}` };
  }
  return { kind: 'ok', registry: validated.data };
}

export function buildRegistryRoute(deps: RouteDeps): Hono {
  return new Hono()
    .get('/', (c) => {
      const r = loadRegistry(deps.configPath());
      if (r.kind === 'missing') return c.json({ error: 'config-required', message: 'scry.config.yaml does not exist' }, 412);
      if (r.kind === 'malformed') return c.json({ error: 'config-malformed', message: r.detail }, 500);
      return c.json({ registry: r.registry });
    })
    .put('/', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400);
      }
      const parsed = PutBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }

      try {
        await writeConfig(cfgPath, { registry: parsed.data.registry });
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        }
        throw err;
      }
      return c.json({ registry: parsed.data.registry });
    });
}
