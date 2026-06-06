// src/shared/mcp-entry.ts
//
// Shared shape for the public-facing MCP server entry returned by GET
// `/api/mcps` and `/api/onboarding`. The route handlers and the web client
// all use the same type so a wire-format change is caught at compile time
// in every consumer.
//
// Distinct from `McpServerConfig` in `config/types.ts` (the on-disk YAML
// shape with `enabled?: boolean`) — this is the API projection where
// `enabled` is canonicalized to a boolean.

import type { McpServerConfig } from '../config/types.js';

export interface McpServerEntry {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

/** Project an on-disk config entry into its public API shape. */
export function toMcpEntry(name: string, cfg: McpServerConfig): McpServerEntry {
  return {
    name,
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
    enabled: cfg.enabled ?? true,
  };
}
