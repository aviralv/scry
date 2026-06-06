import { Hono } from 'hono';
import { existsSync } from 'fs';
import { LlmConfigSchema } from '../../config/schema.js';
import { writeConfigDoc } from '../../config/write-config.js';
import { writeDotEnv, DotEnvValidationError } from '../../config/dotenv-write.js';
import { isEnvRef } from '../../config/env-ref.js';
import { isAllowedBaseUrl } from '../ssrf.js';
import { runLlmTest as realRunLlmTest, type LlmTestInput, type LlmTestResult } from '../llm-test.js';
import { zodToApiErrors } from '../../shared/api-errors.js';

interface RouteDeps {
  configPath: string;
  envPath: string;
  llmTest?: (input: LlmTestInput) => Promise<LlmTestResult>;
}

export function buildLlmRoute(deps: RouteDeps): Hono {
  const llmTest = deps.llmTest ?? realRunLlmTest;

  return new Hono()
    .post('/test', async (c) => {
      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = LlmConfigSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const ssrf = isAllowedBaseUrl(parsed.data.base_url);
      if (!ssrf.ok) {
        return c.json({ error: 'invalid-body', errors: [{ path: ['base_url'], message: ssrf.reason }] }, 400);
      }
      const r = await llmTest(parsed.data);
      return c.json(r);
    })

    .put('/', async (c) => {
      const cfgPath = deps.configPath;
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try { raw = await c.req.json(); } catch { return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400); }
      const parsed = LlmConfigSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }
      const ssrf = isAllowedBaseUrl(parsed.data.base_url);
      if (!ssrf.ok) {
        return c.json({ error: 'invalid-body', errors: [{ path: ['base_url'], message: ssrf.reason }] }, 400);
      }

      // Decide: literal token → .scry.env + rewrite to ${SCRY_LLM_TOKEN}, or ${REF} stays as-is.
      const llmBlock: Record<string, unknown> = {
        base_url: parsed.data.base_url,
        model: parsed.data.model,
      };
      const envKv: Record<string, string> = {};
      if (parsed.data.auth_token !== undefined) {
        if (isEnvRef(parsed.data.auth_token)) {
          llmBlock.auth_token = parsed.data.auth_token;
        } else {
          envKv.SCRY_LLM_TOKEN = parsed.data.auth_token;
          llmBlock.auth_token = '${SCRY_LLM_TOKEN}';
        }
      }

      try {
        // Write env first if needed (validates synchronously before any I/O via writeDotEnv).
        if (Object.keys(envKv).length > 0) {
          // Env first, config second. The two-phase write has a partial-write
          // trade-off: if the config write fails after the env write,
          // .scry.env has a dangling SCRY_LLM_TOKEN. Self-healing on retry
          // (env write is idempotent for the same key).
          await writeDotEnv(deps.envPath, envKv);
        }

        await writeConfigDoc(cfgPath, (doc) => {
          doc.set('llm', llmBlock);

          // Clear onboarding.llm_skipped if set.
          const onboarding = doc.toJSON()?.onboarding;
          if (onboarding && typeof onboarding === 'object' && (onboarding as { llm_skipped?: boolean }).llm_skipped === true) {
            const next = { ...(onboarding as Record<string, unknown>) };
            delete next.llm_skipped;
            doc.set('onboarding', next);
          }
        });
      } catch (err) {
        // writeDotEnv DotEnvValidationError surfaces as 400 (multi-line value).
        if (err instanceof DotEnvValidationError) {
          return c.json({ error: 'invalid-body', message: err.message }, 400);
        }
        throw err;
      }

      return c.json({ llm: llmBlock });
    });
}
