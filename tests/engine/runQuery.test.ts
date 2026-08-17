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
      inputSchema: { type: 'object', properties: { query: {} } },
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
      expect(systemMsg.content).toContain(FANOUT_DIRECTIVE);
    }
  });

  it('auto-calls configured search tools before synthesis by default', async () => {
    const called: Array<{ tool: string; input: Record<string, unknown> }> = [];
    let capturedMessages: Message[][] = [];
    const provider: Provider = {
      name: 'anthropic',
      async *chat(messages: Message[]) {
        capturedMessages.push(messages);
        yield { type: 'text_delta', text: 'Auto search complete [1]' } as ProviderEvent;
        yield { type: 'done', stopReason: 'end_turn' } as ProviderEvent;
      },
    };

    const conn = fakeMcpConnection('slack', ['slack_search'], (tool, input) => {
      called.push({ tool, input });
      return JSON.stringify({ messages: [{ channel_name: 'team', text: 'result', permalink: 'https://slack.example.com/1' }] });
    });

    const events = await collect(
      runQuery({
        prompt: 'pricing decision',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    expect(called).toEqual([{ tool: 'slack_search', input: { query: 'pricing decision' } }]);
    expect(events.some((e) => e.type === 'tool-result')).toBe(true);
    expect(capturedMessages[0].some((m) => m.role === 'tool')).toBe(true);
  });

  it('skips automatic search when fanoutMode is false', async () => {
    let called = false;
    const provider = fakeProvider([
      { type: 'text_delta', text: 'No auto search' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    const conn = fakeMcpConnection('slack', ['slack_search'], () => {
      called = true;
      return '{}';
    });

    await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        fanoutMode: false,
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    expect(called).toBe(false);
  });

  it('enriches automatic search input from matching registry entries', async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const provider = fakeProvider([
      { type: 'text_delta', text: 'Done' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    const config: ScryConfig = {
      ...baseConfig,
      registry: {
        people: {
          marcus: {
            name: 'Marcus Chen',
            aliases: ['marcus'],
            identifiers: { email: 'marcus@example.com', slack_username: 'mchen' },
          },
        },
        projects: {
          pricing: {
            name: 'Pricing Rollout',
            aliases: ['pricing'],
            routing: { slack_channels: ['team-pricing'], jira_project: 'PRICE' },
          },
        },
      },
    };

    const conn: McpConnection = {
      ...fakeMcpConnection('slack', [], (_tool, input) => {
        capturedInput = input;
        return JSON.stringify({ messages: [{ channel_name: 'team-pricing', text: 'result' }] });
      }),
      tools: [{
        name: 'slack__slack_search',
        description: 'slack search',
        inputSchema: { type: 'object', properties: { query: {}, channels: {} } },
      }],
    };

    await collect(
      runQuery({
        prompt: 'what did Marcus say about pricing?',
        config,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    expect(capturedInput?.query).toContain('what did Marcus say about pricing?');
    expect(capturedInput?.query).toContain('marcus@example.com');
    expect(capturedInput?.query).toContain('mchen');
    expect(capturedInput?.query).toContain('PRICE');
    expect(capturedInput?.channels).toEqual(['team-pricing']);
  });

  it('does not auto-call configured search tools that are unavailable from MCP', async () => {
    let called = false;
    const provider = fakeProvider([
      { type: 'text_delta', text: 'Done' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const conn = fakeMcpConnection('slack', ['slack_read'], () => {
      called = true;
      return '{}';
    });

    await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    expect(called).toBe(false);
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

  it('merges parsed sources with tracker URLs by source and title instead of index', async () => {
    let callCount = 0;
    const provider: Provider = {
      name: 'anthropic',
      async *chat() {
        callCount++;
        if (callCount === 1) {
          yield { type: 'tool_use_start', id: 'slack-call', name: 'slack__slack_search' } as ProviderEvent;
          yield { type: 'tool_use_end', id: 'slack-call', name: 'slack__slack_search', input: {} } as ProviderEvent;
          yield { type: 'tool_use_start', id: 'conf-call', name: 'confluence-jira__confluence_search' } as ProviderEvent;
          yield { type: 'tool_use_end', id: 'conf-call', name: 'confluence-jira__confluence_search', input: {} } as ProviderEvent;
          yield { type: 'done', stopReason: 'tool_use' } as ProviderEvent;
        } else {
          yield {
            type: 'text_delta',
            text: `Pricing moved to EOQ [1], and Marcus confirmed rollout risk [2].

Sources:
[1] Confluence: Pricing rollout decision memo
[2] Slack: Marcus rollout risk thread`,
          } as ProviderEvent;
          yield { type: 'done', stopReason: 'end_turn' } as ProviderEvent;
        }
      },
    };

    const slack = fakeMcpConnection('slack', ['slack_search'], () => JSON.stringify({
      messages: [{
        channel_name: 'team-search',
        text: 'Marcus rollout risk thread says risk is manageable.',
        permalink: 'https://slack.example.com/risk',
      }],
    }));
    const confluence = fakeMcpConnection('confluence-jira', ['confluence_search'], () => JSON.stringify({
      results: [{
        title: 'Pricing rollout decision memo',
        excerpt: 'Pricing moved to EOQ.',
        url: 'https://confluence.example.com/pricing',
      }],
    }));

    const config: ScryConfig = {
      ...baseConfig,
      mcp_servers: {
        slack: { command: 'slack-mcp' },
        'confluence-jira': { command: 'confluence-jira-mcp' },
      },
    };

    const events = await collect(
      runQuery({
        prompt: 'q',
        config,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [slack, confluence],
      }),
    );

    const done = events.find((e) => e.type === 'done') as Extract<RunQueryEvent, { type: 'done' }>;
    expect(done.sources.map((s) => s.url)).toEqual([
      'https://confluence.example.com/pricing',
      'https://slack.example.com/risk',
    ]);
  });

  it('extracts source cards from non-Slack MCP result envelopes', async () => {
    const provider: Provider = {
      name: 'anthropic',
      async *chat() {
        yield { type: 'tool_use_start', id: 't1', name: 'ms365__outlook_list_messages' } as ProviderEvent;
        yield { type: 'tool_use_end', id: 't1', name: 'ms365__outlook_list_messages', input: {} } as ProviderEvent;
        yield { type: 'done', stopReason: 'tool_use' } as ProviderEvent;
      },
    };

    const conn = fakeMcpConnection('ms365', ['outlook_list_messages'], () => JSON.stringify({
      emails: [{
        subject: 'Budget approval',
        preview: 'Approved for next quarter.',
        webUrl: 'https://outlook.example.com/message/1',
        from: 'cfo@example.com',
        date: '2026-08-17T09:00:00Z',
      }],
    }));

    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        providerOverride: provider,
        mcpConnections: [conn],
      }),
    );

    const toolResult = events.find((e) => e.type === 'tool-result') as Extract<RunQueryEvent, { type: 'tool-result' }>;
    expect(toolResult.source).toMatchObject({
      title: 'Budget approval',
      snippet: 'Approved for next quarter.',
      url: 'https://outlook.example.com/message/1',
      author: 'cfo@example.com',
      timestamp: '2026-08-17T09:00:00Z',
    });
  });
});
