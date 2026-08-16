import { writeConfig, type WriteConfigMergeFn } from './write-config.js';
import { writeDotEnv } from './dotenv-write.js';
import { DotEnvValidationError } from './dotenv-write.js';

/**
 * Two-phase atomic write across scry.config.yaml + .scry.env.
 *
 * Env validation runs synchronously before any I/O. Config validation runs
 * INSIDE the file lock (inside writeConfig's merge callback), which is safe
 * because env validation already passed.
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
 * For validation failures: env validation runs before any I/O, so a
 * failure there leaves both files completely unchanged. Config validation
 * failures (inside the lock) also leave both files unchanged because
 * writeConfig only writes after validation passes.
 */
export async function writeConfigAndEnv(
  configPath: string,
  envPath: string,
  merge: WriteConfigMergeFn,
  envKv: Record<string, string>,
): Promise<void> {
  // --- Env validation phase (no I/O) ---

  // Validate env values for \r/\n (throws DotEnvValidationError on failure).
  for (const [k, v] of Object.entries(envKv)) {
    if (/[\r\n]/.test(v)) throw new DotEnvValidationError(k, 'multi-line values are not allowed');
  }

  // --- Write phase ---

  // Env first (skips I/O entirely when kv is empty; writeDotEnv re-validates
  // but that's cheap and ensures the env write is always internally consistent).
  await writeDotEnv(envPath, envKv);

  // Config second. Validation happens inside writeConfig (inside the lock),
  // after the merge callback runs against the freshly-read current state.
  await writeConfig(configPath, merge);
}
