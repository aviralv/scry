// src/engine/types.ts
import type { ScryConfig } from '../config/types.js';

export interface SourceCard {
  index: number;        // 1-based, stable across follow-up turns
  source: string;       // server name (e.g. 'slack')
  tool: string;         // tool name (e.g. 'slack_search')
  title: string;
  snippet: string;
  url?: string;
  author?: string;
  timestamp?: string;
}

export interface Citation {
  index: number;
  source: string;
  title: string;
  url?: string;
  author?: string;
  timestamp?: string;
}

export interface RunQueryOptions {
  prompt: string;
  config: ScryConfig;
  scryConfigDir: string;       // absolute path; used for MCP server cwd
  signal?: AbortSignal;
  resume?: string;             // session ID from a prior turn (for multi-turn)
  fanoutMode?: boolean;        // adds a system-prompt directive
}

export type RunQueryEvent =
  | { type: 'session-init'; sessionId: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; sourceIndex: number; source: SourceCard }
  | { type: 'assistant-text'; text: string }
  | { type: 'sources-finalized'; sources: SourceCard[] }    // canonical source list from Claude's enumeration
  | { type: 'done'; sessionId: string; sources: SourceCard[]; finalAnswer: string }
  | { type: 'error'; message: string };
