import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parseDocument } from 'yaml';
import { McpServerConfigSchema } from '../../config/schema.js';
import { writeDotEnv, DotEnvValidationError } from '../../config/dotenv-write.js';
import { writeConfigDoc, ConfigNameExistsError } from '../../config/write-config.js';
import { healthCheck as realHealthCheck, type HealthCheckResult } from '../mcp-health.js';
import type { McpServerConfig } from '../../config/types.js';
import { zodToApiErrors } from '../../shared/api-errors.js';

const NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const SkipBody = z.object({ step: z.enum(['llm', 'mcps']) });
const McpsBody = z.object({
  name: z.string().regex(NAME_RE),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  envValues: z.record(z.string(), z.string()).default({}),
  envRefs: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
});

interface RouteDeps {
  configPath: () => string;
  envPath: () => string;
  healthCheck?: (server: McpServerConfig, opts?: { timeoutMs?: number }) => Promise<HealthCheckResult>;
}

interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

function readDoc(configPath: string): ReturnType<typeof parseDocument> {
  const raw = readFileSync(configPath, 'utf-8');
  return parseDocument(raw);
}

function readEnvKeys(envPath: string): string[] {
  if (!existsSync(envPath)) return [];
  try {
    const raw = readFileSync(envPath, 'utf-8');
    const out: string[] = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key) out.push(key);
    }
    return out;
  } catch {
    return [];
  }
}

const WELL_KNOWN_ENV_REFS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'SLACK_TOKEN',
  'MS365_CLIENT_ID',
  'ATLASSIAN_URL',
  'ATLASSIAN_EMAIL',
  'ATLASSIAN_API_TOKEN',
];

function computeDetectedRefs(envKeys: string[]): string[] {
  const out: string[] = [];
  for (const ref of WELL_KNOWN_ENV_REFS) {
    if (process.env[ref] !== undefined || envKeys.includes(ref)) out.push(ref);
  }
  return out;
}

function toEntry(name: string, cfg: McpServerConfig): McpServerEntry {
  return { name, command: cfg.command, args: cfg.args, env: cfg.env, enabled: cfg.enabled ?? true };
}

export function buildOnboardingRoute(deps: RouteDeps): Hono {
  const healthCheck = deps.healthCheck ?? realHealthCheck;

  return new Hono()
    .get('/', (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      const doc = readDoc(cfgPath);
      const json = doc.toJSON() ?? {};

      // Build llm shape — hasAuth replaces the raw token to prevent leakage.
      const llmRaw = json.llm;
      const llm =
        llmRaw && llmRaw.base_url && llmRaw.model
          ? {
              base_url: llmRaw.base_url,
              model: llmRaw.model,
              hasAuth:
                typeof llmRaw.auth_token === 'string' && llmRaw.auth_token.length > 0,
            }
          : null;

      const mcpsRaw: Record<string, McpServerConfig> = json.mcp_servers ?? {};
      const mcps = Object.entries(mcpsRaw).map(([n, s]) => toEntry(n, s));

      // Default onboarding state if block is absent.
      const onboarding = json.onboarding ?? { completed: false };

      const envKeys = readEnvKeys(deps.envPath());

      return c.json({
        llm,
        mcps,
        onboarding,
        detectedRefs: computeDetectedRefs(envKeys),
        detectedEnvKeys: envKeys,
      });
    })

    .post('/complete', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      await writeConfigDoc(cfgPath, (doc) => {
        const ob = (doc.toJSON()?.onboarding ?? {}) as Record<string, unknown>;
        doc.set('onboarding', { ...ob, completed: true });
      });

      return c.json({ completed: true });
    })

    .post('/skip', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400);
      }

      const parsed = SkipBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }

      const flag = parsed.data.step === 'llm' ? 'llm_skipped' : 'mcps_skipped';
      let next: Record<string, unknown> = {};
      await writeConfigDoc(cfgPath, (doc) => {
        const ob = (doc.toJSON()?.onboarding ?? { completed: false }) as Record<string, unknown>;
        next = { ...ob, [flag]: true };
        doc.set('onboarding', next);
      });

      return c.json({ onboarding: next });
    })

    .post('/mcps', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400);
      }

      const parsed = McpsBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }

      // Optimistic duplicate check (fast path, no lock acquisition for obvious duplicates).
      const doc = readDoc(cfgPath);
      const json = doc.toJSON() ?? {};
      const existingMcps: Record<string, McpServerConfig> = json.mcp_servers ?? {};
      if (existingMcps[parsed.data.name]) {
        return c.json({ error: 'name-exists', message: `MCP "${parsed.data.name}" already exists` }, 409);
      }

      // Build the MCP entry. envValues + envRefs both become ${VAR_NAME} refs in the env
      // block; envValues literal values flow to .scry.env separately; envRefs are already
      // in .scry.env so no write needed.
      const finalKeys = new Set([...Object.keys(parsed.data.envValues), ...parsed.data.envRefs]);
      const envBlock: Record<string, string> = {};
      for (const k of finalKeys) {
        envBlock[k] = `\${${k}}`;
      }
      const newServer: McpServerConfig = {
        command: parsed.data.command,
        ...(parsed.data.args ? { args: parsed.data.args } : {}),
        ...(finalKeys.size > 0 ? { env: envBlock } : {}),
      };

      // Validate the new entry shape against McpServerConfigSchema.
      const entryParse = McpServerConfigSchema.safeParse(newServer);
      if (!entryParse.success) {
        return c.json(
          { error: 'invalid-body', errors: zodToApiErrors(entryParse.error.issues) },
          400,
        );
      }

      // Health-check BEFORE any write. The probe env combines:
      // - envRefs as ${K} refs so resolveDeclaredEnv picks them up from process.env
      //   (they're already in .scry.env which was loaded at boot)
      // - envValues as literals for newly-typed values not yet on disk
      const probeEnv: Record<string, string> = {
        ...Object.fromEntries(parsed.data.envRefs.map(k => [k, `\${${k}}`])),
        ...parsed.data.envValues,
      };
      const probeServer: McpServerConfig = {
        ...newServer,
        ...(Object.keys(probeEnv).length > 0 ? { env: probeEnv } : {}),
      };
      const hc = await healthCheck(probeServer, { timeoutMs: 15_000 });
      if (!hc.ok) return c.json({ error: 'health-check-failed', message: hc.error }, 422);

      // Two-phase write: env first, config second.
      // Same partial-write trade-off as writeConfigAndEnv: if config write fails after
      // env write, .scry.env has dangling keys. Self-healing on retry.
      try {
        if (Object.keys(parsed.data.envValues).length > 0) {
          await writeDotEnv(deps.envPath(), parsed.data.envValues);
        }

        await writeConfigDoc(cfgPath, (doc) => {
          const json2 = doc.toJSON() ?? {};

          // Authoritative duplicate check inside the lock — race-safe.
          const existing2: Record<string, McpServerConfig> = json2.mcp_servers ?? {};
          if (existing2[parsed.data.name]) {
            throw new ConfigNameExistsError(parsed.data.name);
          }

          const mcps2 = { ...existing2, [parsed.data.name]: newServer };
          doc.set('mcp_servers', mcps2);

          // Clear mcps_skipped if set, preserving other onboarding fields.
          const ob = doc.toJSON()?.onboarding;
          if (
            ob &&
            typeof ob === 'object' &&
            (ob as { mcps_skipped?: boolean }).mcps_skipped === true
          ) {
            const next = { ...(ob as Record<string, unknown>) };
            delete next.mcps_skipped;
            doc.set('onboarding', next);
          }
        });
      } catch (err) {
        if (err instanceof ConfigNameExistsError) {
          return c.json(
            { error: 'name-exists', message: `MCP "${err.mcpName}" already exists` },
            409,
          );
        }
        if (err instanceof DotEnvValidationError) {
          return c.json({ error: 'invalid-body', message: err.message }, 400);
        }
        throw err;
      }

      return c.json({ server: toEntry(parsed.data.name, newServer) }, 201);
    });
}
