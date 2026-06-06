// src/config/write-config.ts
//
// Two functions for writing scry.config.yaml. Pick by which block you're
// touching:
//
//   | Block(s)                | Use              | Why                       |
//   | ----------------------- | ---------------- | ------------------------- |
//   | mcp_servers, registry   | writeConfig      | Schema-validated, full    |
//   |                         |                  | replace, race-safe merge  |
//   | llm, onboarding, future | writeConfigDoc   | Raw YAML mutation;        |
//   |                         |                  | caller validates          |
//
// Both hold a proper-lockfile lock around read + mutate + atomic write so
// two concurrent callers don't lose each other's writes.
//
// `writeConfig(path, mergeFn)` — the safe path. Reads, runs `mergeFn` with
// the parsed snapshot inside the lock, validates the resulting block via
// the Zod schemas, atomic-writes. Use for any block that has a schema in
// `schema.ts`.
//
// `writeConfigDoc(path, mutator)` — the escape hatch. Reads as a yaml
// `Document` (preserves comments/formatting), runs `mutator` inside the
// lock, atomic-writes. Validation is the caller's responsibility.

import { promises as fs } from 'fs';
import * as lockfile from 'proper-lockfile';
import { Document, parseDocument } from 'yaml';
import { z, type ZodIssue } from 'zod';
import { atomicWriteConfig } from './atomic-write.js';
import { McpServersMapSchema, RegistrySchema } from './schema.js';
import type { ScryConfig } from './types.js';

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

export class ConfigNameExistsError extends Error {
  constructor(public mcpName: string) {
    super(`MCP "${mcpName}" already exists`);
    this.name = 'ConfigNameExistsError';
  }
}

export class ConfigNotFoundError extends Error {
  constructor(public readonly entity: string, public readonly name: string) {
    super(`${entity} "${name}" not found`);
    this.name = 'ConfigNotFoundError';
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
 * Pure validation of a WriteConfigUpdates object — throws ConfigValidationError
 * on failure, returns the parsed result on success. No I/O. Exported so callers
 * that need to validate before committing multiple writes can do a dry-run first.
 */
export function validateConfigUpdates(updates: WriteConfigUpdates): z.infer<typeof PartialUpdatesSchema> {
  const parsed = PartialUpdatesSchema.safeParse(updates);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: ZodIssue) => ({
      path: i.path.map(String),
      message: i.message,
    }));
    throw new ConfigValidationError(issues);
  }
  return parsed.data;
}

/**
 * Merge callback: receives the current config and returns the updates to apply.
 * Runs INSIDE the file lock after a fresh read, so multiple concurrent callers
 * each see the latest state — not a stale snapshot from before lock acquisition.
 *
 * May throw ConfigNameExistsError (or any other error) to abort the write.
 */
export type WriteConfigMergeFn =
  (current: ScryConfig) => WriteConfigUpdates | Promise<WriteConfigUpdates>;

/**
 * Read-merge-write the YAML doc with a cross-process file lock around the
 * whole cycle, including the merge callback and validation.
 *
 * - The merge callback runs INSIDE the lock against a freshly-read current
 *   state, eliminating the race where two concurrent callers each read their
 *   own snapshot and the loser's update is silently dropped.
 * - `mcp_servers` and `registry` are *replaced wholesale* (deep-merge would
 *   silently drop deleted entries).
 * - Other top-level keys are untouched, with their formatting and comments
 *   preserved (yaml.Document mutation rather than re-stringify-from-JS).
 * - On validation failure, no file write happens.
 */
export async function writeConfig(path: string, merge: WriteConfigMergeFn): Promise<void> {
  // Existence pre-check — proper-lockfile fails on missing target with a
  // less-clear error.
  try {
    await fs.access(path);
  } catch {
    throw new ConfigMissingError(path);
  }

  const release = await lockfile.lock(path, {
    stale: 10_000,
    retries: { retries: 5, minTimeout: 50 },
    onCompromised: (err: Error) => {
      // Don't re-throw inside the timer — that's an unhandled exception.
      // The next release() call will surface ENOTACQUIRED instead.
      console.error(`[writeConfig] lock compromised on ${path}: ${err.message}`);
    },
  });
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      throw new Error(`Config at ${path} contains YAML syntax errors: ${doc.errors[0].message}`);
    }

    // Provide the current config to the merge callback so its updates are
    // computed against the freshly-read state, not a pre-lock snapshot.
    const current = (doc.toJSON() ?? {}) as ScryConfig;
    const updates = await merge(current);

    // Validate INSIDE the lock, after the merge — eliminates the redundant
    // double-parse from the old pre-lock validation path.
    const parsed = validateConfigUpdates(updates);

    if (parsed.mcp_servers !== undefined) {
      doc.set('mcp_servers', parsed.mcp_servers);
    }
    if (parsed.registry !== undefined) {
      doc.set('registry', parsed.registry);
    }

    const out = String(doc);
    await atomicWriteConfig(path, out);
  } finally {
    await release();
  }
}

export type WriteConfigDocMutator = (doc: Document) => void | Promise<void>;

/**
 * Lower-level companion to writeConfig: holds the same file lock, but lets
 * the caller mutate the YAML Document directly. Use this when writing fields
 * that fall outside writeConfig's WriteConfigUpdates shape (llm, onboarding).
 *
 * Validation is the caller's responsibility. The mutator runs INSIDE the lock,
 * after a fresh read — so concurrent callers each see a consistent snapshot
 * and the last writer doesn't silently overwrite an earlier one.
 */
export async function writeConfigDoc(path: string, mutator: WriteConfigDocMutator): Promise<void> {
  // Existence pre-check — proper-lockfile fails on missing target with a less-clear error.
  try {
    await fs.access(path);
  } catch {
    throw new ConfigMissingError(path);
  }

  const release = await lockfile.lock(path, {
    stale: 10_000,
    retries: { retries: 5, minTimeout: 50 },
    onCompromised: (err: Error) => {
      console.error(`[writeConfigDoc] lock compromised on ${path}: ${err.message}`);
    },
  });
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      throw new Error(`Config at ${path} contains YAML syntax errors: ${doc.errors[0].message}`);
    }

    await mutator(doc);

    const out = String(doc);
    await atomicWriteConfig(path, out);
  } finally {
    await release();
  }
}
