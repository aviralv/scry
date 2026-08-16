import { log } from "../logger.js";
import { existsSync, readFileSync } from 'fs';
import { parseDocument } from 'yaml';
import { atomicWriteConfig } from '../../config/atomic-write.js';

export type MigrationResult = 'migrated' | 'skipped';

/**
 * Runs at scry serve boot. If config has llm + ≥1 mcp_servers and no
 * `onboarding` block at all, marks onboarding.completed = true. Treats users
 * who configured via scry init or hand-editing as already-onboarded so the
 * web wizard doesn't hijack them.
 *
 * Skips if: config missing; config malformed; onboarding block already present
 * (any value); llm absent; mcp_servers empty.
 *
 * Idempotent — safe to call repeatedly. Logs the outcome to stderr.
 */
export async function runOnboardingAutocomplete(configPath: string): Promise<MigrationResult> {
  if (!existsSync(configPath)) return 'skipped';

  let doc;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    doc = parseDocument(raw);
    if (doc.errors.length > 0) return 'skipped';
  } catch {
    return 'skipped';
  }

  // Skip if onboarding block exists with any value (don't second-guess hand-edits).
  const onboarding = doc.get('onboarding');
  if (onboarding !== undefined && onboarding !== null) return 'skipped';

  // Skip if llm absent.
  const llm = doc.get('llm');
  if (llm === undefined || llm === null) return 'skipped';

  // Skip if mcp_servers empty.
  const json = doc.toJSON() ?? {};
  const mcpServers = json.mcp_servers;
  if (!mcpServers || typeof mcpServers !== 'object' || Object.keys(mcpServers).length === 0) {
    return 'skipped';
  }

  doc.set('onboarding', { completed: true });
  await atomicWriteConfig(configPath, String(doc));

  log.info(`migrated existing config — onboarding marked complete (${configPath})`);
  return 'migrated';
}
