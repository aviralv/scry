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
  raw: unknown;         // original tool_result content
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
  scryConfigDir: string;       // absolute path; passed as Options.cwd to the SDK
  signal?: AbortSignal;
  resume?: string;             // SDK session_id from a prior turn
  fanoutMode?: boolean;        // adds a system-prompt directive
  priorSources?: SourceCard[]; // session's prior sources for follow-up turns
}

export type RunQueryEvent =
  | { type: 'session-init'; sessionId: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; sourceIndex: number; source: SourceCard }
  | { type: 'assistant-text'; text: string }
  | { type: 'citation'; index: number; source: SourceCard }
  | { type: 'done'; sessionId: string; sources: SourceCard[]; finalAnswer: string }
  | { type: 'error'; message: string };
