// src/engine/providers/index.ts
// Provider registry. Maps LlmProvider enum values to provider instances.

import type { LlmProvider } from '../../config/types.js';
import type { Provider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

const providers: Record<LlmProvider, () => Provider> = {
  anthropic: () => new AnthropicProvider(),
  openai: () => new OpenAIProvider('openai'),
  gemini: () => new OpenAIProvider('gemini'),
  ollama: () => new OpenAIProvider('ollama'),
};

export function getProvider(name: LlmProvider): Provider {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown LLM provider: ${name}`);
  return factory();
}

export type { Provider, ProviderOptions, ProviderEvent, ToolDef, Message, TextBlock, ToolUseBlock } from './types.js';
