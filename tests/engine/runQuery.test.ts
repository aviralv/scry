import { describe, it, expect } from 'vitest';
import { runQuery } from '../../src/engine/runQuery.js';
import { FANOUT_DIRECTIVE } from '../../src/engine/system-prompt.js';
import type { ScryConfig } from '../../src/config/types.js';
import type { RunQueryEvent } from '../../src/engine/types.js';
import type { Provider, ProviderOptions, Message, ToolDef, ProviderEvent } from '../../src/engine/providers/types.js';
import type { McpConnection } from '../../src/engine/mcp-client.js';

const baseConfig: ScryConfig = {
  llm: { base_url: 'http://x', auth_token: 'test-key', model: 'claude-haiku' },
  mcp_servers: { slack: { command: 'slack-mcp' } },
  search_tools: { slack: [{ tool: 'slack_search', params: {} }] },
  registry: { people: {}, projects: {} },
};

async function collect(stream: AsyncIterable<RunQueryEvent>): Promise<RunQueryEvent[]> {
  const events: RunQueryEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

/** Creates a fake provider that yields the given events. */
function fakeProvider(events: ProviderEvent[], onChat?: (msgs: Message[], tools: ToolDef[]) => void): Provider {
  return {
    name: 'anthropic',
    async *chat(messages: Message[], tools: ToolDef[], _options: ProviderOptions) {
      onChat?.(messages, tools);
      for (const e of events) yield e;
    },
  };
}

/** Creates a fake MCP connection with the given tools. */
function fakeMcpConnection(name: string, tools: string[], callHandler?: (tool: string, input: Record<string, unknown>) => string): McpConnection {
  return {
    name,
    client: {
      callTool: async ({ name: toolName, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => {
        const result = callHandler?.(toolName, args ?? {}) ?? '{"title":"result","snippet":"test"}';
        return { content: [{ type: 'text', text: result }] };
      },
      close: async () => {},
      listTools: async () => ({ tools: [] }),
    } as never,
    transport: {} as never,
    tools: tools.map((t) => ({
      name: `${name}__${t}`,
      description: `${t} tool`,
      inputSchema: { type: 'object', properties: {} },
    })),
  };
}

describe('runQuery', () => {
  it('emits session-init then assistant-text then done for a simple stream', async () => {
    const provider = fakeProvider([
      { type: 'text_delta', text: 'Hello' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    const events = await collect(
      runQuery({
        prompt: 'hi',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [],
      }),
    );

    expect(events[0]).toMatchObject({ type: 'session-init' });
    expect(events.some((e) => e.type === 'assistant-text' && e.text === 'Hello')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'done' });
  });

  it('executes tool calls and feeds results back', async () => {
    let callCount = 0;
    const provider: Provider = {
      name: 'anthropic',
      async *chat(messages: Message[]) {
        callCount++;
        if (callCount === 1) {
          // First call: LLM requests a tool call
          yield { type: 'tool_use_start', id: 't1', name: 'slack__slack_search' } as ProviderEvent;
          yield { type: 'tool_use_end', id: 't1', name: 'slack__slack_search', input: { query: 'andre' } } as ProviderEvent;
          yield { type: 'done', stopReason: 'tool_use' } as ProviderEvent;
        } else {
          // Second call: LLM synthesizes with tool result
          yield { type: 'text_delta', text: 'Andre said X [1]' } as ProviderEvent;
          yield { type: 'done', stopReason: 'end_turn' } as ProviderEvent;
        }
      },
    };

    const conn = fakeMcpConnection('slack', ['slack_search'], () =>
      JSON.stringify([{ title: 'A msg', snippet: 'andre said x', author: 'andre' }]),
    );

    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toBeDefined();
    expect(callCount).toBe(2);
    const done = events.find((e) => e.type === 'done') as Extract<RunQueryEvent, { type: 'done' }>;
    expect(done.finalAnswer).toContain('Andre said X');
  });

  it('emits error event on provider failure', async () => {
    const provider: Provider = {
      name: 'anthropic',
      async *chat() {
        throw new Error('API key invalid');
      },
    };

    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [],
      }),
    );

    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    if (errEvent && errEvent.type === 'error') {
      expect(errEvent.message).toContain('API key invalid');
    }
  });

  it('respects MAX_TOOL_TURNS and stops looping', async () => {
    let callCount = 0;
    const provider: Provider = {
      name: 'anthropic',
      async *chat() {
        callCount++;
        // Always request another tool call — tests the safety limit
        yield { type: 'tool_use_start', id: `t${callCount}`, name: 'slack__slack_search' } as ProviderEvent;
        yield { type: 'tool_use_end', id: `t${callCount}`, name: 'slack__slack_search', input: {} } as ProviderEvent;
        yield { type: 'done', stopReason: 'tool_use' } as ProviderEvent;
      },
    };

    const conn = fakeMcpConnection('slack', ['slack_search']);
    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    // MAX_TOOL_TURNS = 10
    expect(callCount).toBe(10);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('passes tools from MCP connections to the provider', async () => {
    let capturedTools: ToolDef[] = [];
    const provider = fakeProvider(
      [{ type: 'done', stopReason: 'end_turn' }],
      (_msgs, tools) => { capturedTools = tools; },
    );

    const conn = fakeMcpConnection('slack', ['slack_search', 'slack_read']);
    await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    expect(capturedTools.map((t) => t.name)).toEqual(['slack__slack_search', 'slack__slack_read']);
  });

  it('includes the system prompt with registry context', async () => {
    let capturedMessages: Message[] = [];
    const provider = fakeProvider(
      [{ type: 'done', stopReason: 'end_turn' }],
      (msgs) => { capturedMessages = msgs; },
    );

    const config: ScryConfig = {
      ...baseConfig,
      registry: { people: { john: { name: 'John', identifiers: {} } }, projects: {} },
    };

    await collect(
      runQuery({
        prompt: 'q',
        config,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [],
      }),
    );

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    if (systemMsg && systemMsg.role === 'system') {
      expect(systemMsg.content).toContain('John');
    }
  });

  it('includes fanout directive when fanoutMode is true', async () => {
    let capturedMessages: Message[] = [];
    const provider = fakeProvider(
      [{ type: 'done', stopReason: 'end_turn' }],
      (msgs) => { capturedMessages = msgs; },
    );

    await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        fanoutMode: true,
        providerOverride: provider,
        mcpConnections: [],
      }),
    );

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    if (systemMsg && systemMsg.role === 'system') {
      expect(systemMsg.content).toContain(FANOUT_DIRECTIVE);
    }
  });

  it('does NOT include fanout directive by default', async () => {
    let capturedMessages: Message[] = [];
    const provider = fakeProvider(
      [{ type: 'done', stopReason: 'end_turn' }],
      (msgs) => { capturedMessages = msgs; },
    );

    await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [],
      }),
    );

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    if (systemMsg && systemMsg.role === 'system') {
      expect(systemMsg.content).not.toContain(FANOUT_DIRECTIVE);
    }
  });

  it('handles multi-turn text accumulation in finalAnswer', async () => {
    let callCount = 0;
    const provider: Provider = {
      name: 'anthropic',
      async *chat() {
        callCount++;
        if (callCount === 1) {
          yield { type: 'text_delta', text: 'Searching...' } as ProviderEvent;
          yield { type: 'tool_use_start', id: 't1', name: 'slack__slack_search' } as ProviderEvent;
          yield { type: 'tool_use_end', id: 't1', name: 'slack__slack_search', input: {} } as ProviderEvent;
          yield { type: 'done', stopReason: 'tool_use' } as ProviderEvent;
        } else {
          yield { type: 'text_delta', text: 'Found results.' } as ProviderEvent;
          yield { type: 'done', stopReason: 'end_turn' } as ProviderEvent;
        }
      },
    };

    const conn = fakeMcpConnection('slack', ['slack_search']);
    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    const done = events.find((e) => e.type === 'done') as Extract<RunQueryEvent, { type: 'done' }>;
    expect(done.finalAnswer).toContain('Searching...');
    expect(done.finalAnswer).toContain('Found results.');
  });

  it('parses sources from final answer when present', async () => {
    const answer = `The team decided X [1].

Sources:
[1] slack: #team-channel — https://slack.example.com/123`;

    const provider = fakeProvider([
      { type: 'text_delta', text: answer },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [],
      }),
    );

    const finalized = events.find((e) => e.type === 'sources-finalized');
    expect(finalized).toBeDefined();
    if (finalized && finalized.type === 'sources-finalized') {
      expect(finalized.sources.length).toBeGreaterThan(0);
      expect(finalized.sources[0].source).toBe('slack');
    }
  });
});
