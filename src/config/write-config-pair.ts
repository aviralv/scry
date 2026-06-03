import { writeConfig, validateConfigUpdates, type WriteConfigUpdates } from './write-config.js';
import { writeDotEnv } from './dotenv-write.js';
import { DotEnvValidationError } from './dotenv-write.js';

/**
 * Two-phase atomic write across scry.config.yaml + .scry.env.
 *
 * Both helpers validate synchronously before any I/O, so we run both
 * validations first — before touching any file. Only if BOTH validations
 * pass do we proceed to write.
 *
 * Write order: env first, config second. This matters if a write error
 * (distinct from validation error) occurs mid-flight:
 * - env partial-write + config pending → user retries same config write,
 *   env already has the key (harmless duplicate write on retry).
 * - config write failed → env has a "dangling" key, but runtime resolution
 *   of a missing env value produces "" rather than a hard crash.
 *
 * The alternative (config first) would leave config referencing a key that
 * doesn't exist in env, which silently breaks runtime resolution until
 * manual recovery. Env-first is the safer ordering for partial failures.
 *
 * For validation failures: both validations run before any I/O, so a
 * failure on either side leaves both files completely unchanged.
 */
export async function writeConfigAndEnv(
  configPath: string,
  envPath: string,
  configUpdates: WriteConfigUpdates,
  envKv: Record<string, string>,
): Promise<void> {
  // --- Validation phase (no I/O) ---

  // Validate env values for \r/\n (throws DotEnvValidationError on failure).
  for (const [k, v] of Object.entries(envKv)) {
    if (/[\r\n]/.test(v)) throw new DotEnvValidationError(k, 'multi-line values are not allowed');
  }

  // Validate config updates via Zod (throws ConfigValidationError on failure).
  validateConfigUpdates(configUpdates);

  // --- Write phase ---

  // Env first (skips I/O entirely when kv is empty; writeDotEnv re-validates
  // but that's cheap and ensures the env write is always internally consistent).
  await writeDotEnv(envPath, envKv);

  // Config second.
  await writeConfig(configPath, configUpdates);
}
