// src/engine/providers/anthropic.ts
// Anthropic Messages API provider. Streams responses using the SDK's
// native streaming support. Maps between the common provider interface
// and Anthropic's content-block-based format.

import Anthropic from '@anthropic-ai/sdk';
import type { Provider, ProviderOptions, Message, ToolDef, ProviderEvent } from './types.js';

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic' as const;

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    options: ProviderOptions,
  ): AsyncIterable<ProviderEvent> {
    const client = new Anthropic({
      apiKey: options.apiKey ?? undefined,
      baseURL: options.baseUrl,
    });

    // Separate system message from conversation messages.
    const systemMessages = messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n') || undefined;

    // Convert to Anthropic message format.
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => toAnthropicMessage(m));

    // Convert tool definitions to Anthropic format.
    const anthropicTools = tools.length > 0
      ? tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
        }))
      : undefined;

    const stream = client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools,
    }, { signal: options.signal ?? undefined });

    // Track tool_use blocks being built up.
    const toolInputBuffers = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'text') {
          // Will get text deltas
        } else if (block.type === 'tool_use') {
          toolInputBuffers.set(event.index, { id: block.id, name: block.name, json: '' });
          yield { type: 'tool_use_start', id: block.id, name: block.name };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', text: delta.text };
        } else if (delta.type === 'input_json_delta') {
          const buf = toolInputBuffers.get(event.index);
          if (buf) {
            buf.json += delta.partial_json;
            yield { type: 'tool_use_delta', id: buf.id, input: delta.partial_json };
          }
        }
      } else if (event.type === 'content_block_stop') {
        const buf = toolInputBuffers.get(event.index);
        if (buf) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(buf.json || '{}'); } catch { /* empty */ }
          yield { type: 'tool_use_end', id: buf.id, name: buf.name, input };
          toolInputBuffers.delete(event.index);
        }
      } else if (event.type === 'message_delta') {
        const stopReason = event.delta.stop_reason;
        if (stopReason === 'end_turn' || stopReason === 'tool_use' || stopReason === 'max_tokens') {
          yield { type: 'done', stopReason };
        }
      }
    }
  }
}

function toAnthropicMessage(m: Message): Anthropic.MessageParam {
  if (m.role === 'user') {
    return { role: 'user', content: m.content };
  }
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content.map((block) => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text };
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }),
    };
  }
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: m.toolUseId,
        content: m.content,
      }],
    };
  }
  // System messages should be filtered out before this point.
  return { role: 'user', content: '' };
}
