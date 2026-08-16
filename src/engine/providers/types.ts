// src/engine/providers/types.ts
// Common interface for LLM providers. Each provider translates between
// this contract and its native API (Anthropic Messages, OpenAI Chat
// Completions, Gemini GenerateContent, Ollama /api/chat).

import type { LlmProvider } from '../../config/types.js';

/** Tool definition passed to the LLM (derived from MCP tool schemas). */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A message in the conversation. */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: Array<TextBlock | ToolUseBlock> }
  | { role: 'tool'; toolUseId: string; content: string };

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Events streamed from the provider during generation. */
export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input: string }
  | { type: 'tool_use_end'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' };

export interface ProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Interface every provider must implement. */
export interface Provider {
  readonly name: LlmProvider;
  chat(
    messages: Message[],
    tools: ToolDef[],
    options: ProviderOptions,
  ): AsyncIterable<ProviderEvent>;
}

/** Registry of provider factories. */
export type ProviderFactory = () => Provider;
