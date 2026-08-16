// src/engine/providers/openai.ts
// OpenAI Chat Completions provider. Also serves as the adapter for
// OpenAI-compatible APIs: Ollama (/v1/chat/completions), Google Gemini
// (via their OpenAI-compatible endpoint), and any other provider that
// speaks the OpenAI wire format.

import OpenAI from 'openai';
import type { Provider, ProviderOptions, Message, ToolDef, ProviderEvent } from './types.js';
import type { LlmProvider } from '../../config/types.js';

export class OpenAIProvider implements Provider {
  readonly name: LlmProvider;

  constructor(providerName: LlmProvider = 'openai') {
    this.name = providerName;
  }

  async *chat(
    messages: Message[],
    tools: ToolDef[],
    options: ProviderOptions,
  ): AsyncIterable<ProviderEvent> {
    const client = new OpenAI({
      apiKey: options.apiKey ?? 'ollama',  // Ollama doesn't need a key; 'ollama' is a placeholder
      baseURL: options.baseUrl.replace(/\/$/, '') + '/v1',
    });

    // Convert messages to OpenAI format.
    const openaiMessages = toOpenAIMessages(messages);

    // Convert tools to OpenAI format.
    const openaiTools = tools.length > 0
      ? tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }))
      : undefined;

    const stream = await client.chat.completions.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      messages: openaiMessages,
      tools: openaiTools,
      stream: true,
    }, { signal: options.signal ?? undefined });

    // Track tool calls being built up from deltas.
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Text content
      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls.has(idx)) {
            const id = tc.id ?? `call_${idx}`;
            const name = tc.function?.name ?? '';
            toolCalls.set(idx, { id, name, args: '' });
            if (name) {
              yield { type: 'tool_use_start', id, name };
            }
          }
          const buf = toolCalls.get(idx)!;
          if (tc.id && !buf.id.startsWith('call_')) buf.id = tc.id;
          if (tc.function?.name && !buf.name) {
            buf.name = tc.function.name;
            yield { type: 'tool_use_start', id: buf.id, name: buf.name };
          }
          if (tc.function?.arguments) {
            buf.args += tc.function.arguments;
            yield { type: 'tool_use_delta', id: buf.id, input: tc.function.arguments };
          }
        }
      }

      // Finish reason
      if (choice.finish_reason) {
        // Emit tool_use_end for any accumulated tool calls.
        for (const [, buf] of toolCalls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(buf.args || '{}'); } catch { /* empty */ }
          yield { type: 'tool_use_end', id: buf.id, name: buf.name, input };
        }
        toolCalls.clear();

        const stopReason = choice.finish_reason === 'tool_calls'
          ? 'tool_use'
          : choice.finish_reason === 'length'
            ? 'max_tokens'
            : 'end_turn';
        yield { type: 'done', stopReason };
      }
    }
  }
}

type OpenAIMessage = OpenAI.ChatCompletionMessageParam;

function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const content = m.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('') || undefined;
      const toolCalls = m.content
        .filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
      out.push({
        role: 'assistant',
        content: content ?? null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolUseId,
        content: m.content,
      });
    }
  }
  return out;
}
