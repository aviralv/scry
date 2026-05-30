import { promises as fs } from 'fs';
import * as lockfile from 'proper-lockfile';
import { Document, parseDocument } from 'yaml';
import { z, type ZodIssue } from 'zod';
import { atomicWriteConfig } from './atomic-write.js';
import { McpServersMapSchema, RegistrySchema } from './schema.js';

export class ConfigMissingError extends Error {
  constructor(public path: string) {
    super(`Config not found at ${path}`);
    this.name = 'ConfigMissingError';
  }
}

export class ConfigValidationError extends Error {
  constructor(public issues: { path: string[]; message: string }[]) {
    super('Config validation failed');
    this.name = 'ConfigValidationError';
  }
}

export interface WriteConfigUpdates {
  mcp_servers?: Record<string, unknown>;
  registry?: unknown;
}

const PartialUpdatesSchema = z.object({
  mcp_servers: McpServersMapSchema.optional(),
  registry: RegistrySchema.optional(),
});

/**
 * Validate updates, then read-merge-write the YAML doc with a cross-process
 * file lock around the whole cycle.
 *
 * - `mcp_servers` and `registry` are *replaced wholesale* (deep-merge would
 *   silently drop deleted entries).
 * - Other top-level keys are untouched, with their formatting and comments
 *   preserved (yaml.Document mutation rather than re-stringify-from-JS).
 * - On validation failure, no file write happens.
 */
export async function writeConfig(path: string, updates: WriteConfigUpdates): Promise<void> {
  // Existence pre-check — proper-lockfile fails on missing target with a
  // less-clear error.
  try {
    await fs.access(path);
  } catch {
    throw new ConfigMissingError(path);
  }

  // Validate up front. Short-circuits before any fs touch beyond the
  // existence check above.
  const parsed = PartialUpdatesSchema.safeParse(updates);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: ZodIssue) => ({
      path: i.path.map(String),
      message: i.message,
    }));
    throw new ConfigValidationError(issues);
  }

  const release = await lockfile.lock(path, { stale: 10_000, retries: { retries: 5, minTimeout: 50 } });
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const doc = parseDocument(raw);

    if (parsed.data.mcp_servers !== undefined) {
      doc.set('mcp_servers', parsed.data.mcp_servers);
    }
    if (parsed.data.registry !== undefined) {
      doc.set('registry', parsed.data.registry);
    }

    const out = String(doc);
    await atomicWriteConfig(path, out);
  } finally {
    await release();
  }
}

// Helper used by route handlers so they don't have to import yaml directly.
export async function readConfigDoc(path: string): Promise<Document> {
  const raw = await fs.readFile(path, 'utf-8');
  return parseDocument(raw);
}
