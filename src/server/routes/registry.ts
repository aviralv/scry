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

function loadRegistry(configPath: string): Registry | null {
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw) as { registry?: Registry } | undefined;
  return parsed?.registry ?? EMPTY_REGISTRY;
}

export function buildRegistryRoute(deps: RouteDeps): Hono {
  return new Hono()
    .get('/', (c) => {
      const reg = loadRegistry(deps.configPath());
      if (reg === null) return c.json({ error: 'config-required', message: 'scry.config.yaml does not exist' }, 412);
      return c.json({ registry: reg });
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
