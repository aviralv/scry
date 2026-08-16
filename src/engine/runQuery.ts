// src/engine/runQuery.ts
// Provider-agnostic agentic loop. Replaces the Claude Agent SDK with
// direct LLM API calls + MCP tool execution. Supports any provider that
// implements the Provider interface.

import type { McpServerConfig, LlmProvider } from '../config/types.js';
import type { RunQueryOptions, RunQueryEvent, SourceCard } from './types.js';
import { buildSystemPrompt } from './system-prompt.js';
import { SourceTracker } from './source-tracker.js';
import { parseSources } from './parse-sources.js';
import { getProvider } from './providers/index.js';
import type { Provider, Message, ToolUseBlock, ProviderEvent } from './providers/types.js';
import { connectMcpServers, callTool, disconnectAll, type McpConnection } from './mcp-client.js';
import { parseEnvRef } from '../config/env-ref.js';

export interface RunQueryInternalOptions extends RunQueryOptions {
  /** Dependency-inject fake MCP connections for tests. */
  mcpConnections?: McpConnection[];
  /** Dependency-inject a fake provider for tests. */
  providerOverride?: Provider;
}

const MAX_TOOL_TURNS = 10;

export async function* runQuery(opts: RunQueryInternalOptions): AsyncIterable<RunQueryEvent> {
  const provider = opts.providerOverride ?? getProvider((opts.config.llm.provider as LlmProvider) ?? 'anthropic');

  // Build system prompt.
  const systemPrompt = buildSystemPrompt({
    registry: opts.config.registry ?? { people: {}, projects: {} },
    fanoutMode: opts.fanoutMode ?? false,
    serverNames: Object.keys(opts.config.mcp_servers),
  });

  // Resolve auth token from env refs.
  const rawToken = opts.config.llm.auth_token;
  let apiKey: string | null = null;
  if (rawToken) {
    const refName = parseEnvRef(rawToken);
    if (refName) {
      apiKey = process.env[refName] ?? null;
    } else {
      apiKey = rawToken;
    }
  }

  // Connect to MCP servers (or use injected connections).
  let connections: McpConnection[];
  let ownedConnections = false;
  if (opts.mcpConnections) {
    connections = opts.mcpConnections;
  } else {
    // Resolve env refs in server configs before connecting.
    const resolvedServers = resolveServerEnv(opts.config.mcp_servers);
    connections = await connectMcpServers(resolvedServers, { signal: opts.signal });
    ownedConnections = true;
  }

  // Gather all available tools from connected MCP servers.
  const allTools = connections.flatMap((c) => c.tools);

  // Generate a session ID.
  const sessionId = crypto.randomUUID();
  yield { type: 'session-init', sessionId };

  // Build conversation messages.
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: opts.prompt },
  ];

  const tracker = new SourceTracker([]);
  let finalAnswer = '';

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      // Call LLM.
      const assistantBlocks: Array<{ type: 'text'; text: string } | ToolUseBlock> = [];
      let turnText = '';
      const pendingToolCalls: ToolUseBlock[] = [];
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

      const stream = provider.chat(messages, allTools, {
        baseUrl: opts.config.llm.base_url,
        apiKey,
        model: opts.config.llm.model,
        signal: opts.signal,
      });

      for await (const event of stream) {
        if (opts.signal?.aborted) break;

        switch (event.type) {
          case 'text_delta':
            turnText += event.text;
            yield { type: 'assistant-text', text: event.text };
            break;
          case 'tool_use_start':
            yield { type: 'tool-call', tool: event.name, args: {} };
            break;
          case 'tool_use_end':
            pendingToolCalls.push({
              type: 'tool_use',
              id: event.id,
              name: event.name,
              input: event.input,
            });
            break;
          case 'done':
            stopReason = event.stopReason;
            break;
        }
      }

      if (opts.signal?.aborted) break;

      // Build assistant message from this turn.
      if (turnText) {
        assistantBlocks.push({ type: 'text', text: turnText });
        finalAnswer += (finalAnswer ? '\n' : '') + turnText;
      }
      for (const tc of pendingToolCalls) {
        assistantBlocks.push(tc);
      }
      messages.push({ role: 'assistant', content: assistantBlocks });

      // If no tool calls, we're done.
      if (stopReason !== 'tool_use' || pendingToolCalls.length === 0) {
        break;
      }

      // Execute tool calls and feed results back.
      for (const tc of pendingToolCalls) {
        const result = await callTool(connections, tc.name, tc.input);
        messages.push({ role: 'tool', toolUseId: tc.id, content: result });

        // Track source card.
        const serverName = tc.name.split('__')[0];
        const card = parseToolResultForCard(result, serverName, tc.name, tracker);
        if (card) {
          yield { type: 'tool-result', tool: tc.name, sourceIndex: card.index, source: card };
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
  } finally {
    if (ownedConnections) {
      await disconnectAll(connections);
    }
  }

  // Finalize sources.
  const parsed = parseSources(finalAnswer);
  if (parsed.length > 0) {
    yield { type: 'sources-finalized', sources: parsed };
    yield { type: 'done', sessionId, sources: parsed, finalAnswer };
  } else {
    yield { type: 'done', sessionId, sources: tracker.sources, finalAnswer };
  }
}

// --- helpers ---

function resolveServerEnv(
  servers: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.enabled === false) continue;
    const resolvedEnv: Record<string, string> = {};
    if (cfg.env) {
      for (const [k, v] of Object.entries(cfg.env)) {
        const ref = parseEnvRef(v);
        resolvedEnv[k] = ref ? (process.env[ref] ?? '') : v;
      }
    }
    out[name] = { ...cfg, env: resolvedEnv };
  }
  return out;
}

function parseToolResultForCard(
  raw: string,
  serverName: string,
  toolName: string,
  tracker: SourceTracker,
): SourceCard | null {
  let payload: { title?: string; snippet?: string; author?: string; timestamp?: string; url?: string } = {};
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    payload = first ?? {};
  } catch {
    payload = { title: 'tool result', snippet: raw.slice(0, 200) };
  }

  return tracker.recordToolResult(serverName, toolName, {
    title: payload.title ?? 'untitled',
    snippet: payload.snippet ?? '',
    url: payload.url,
    author: payload.author,
    timestamp: payload.timestamp,
  });
}
