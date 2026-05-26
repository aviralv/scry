import { describe, it, expect } from 'vitest';
import { runQuery } from '../../src/engine/runQuery.js';
import type { ScryConfig } from '../../src/config/types.js';
import type { RunQueryEvent } from '../../src/engine/types.js';

const baseConfig: ScryConfig = {
  llm: { base_url: 'http://x', auth_token: 't', model: 'claude-haiku' },
  mcp_servers: { slack: { command: 'slack-mcp' } },
  search_tools: { slack: [{ tool: 'slack_search', params: {} }] },
  registry: { people: {}, projects: {} },
};

async function collect(stream: AsyncIterable<RunQueryEvent>): Promise<RunQueryEvent[]> {
  const events: RunQueryEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

describe('runQuery', () => {
  it('emits session-init then assistant-text then done for a simple stream', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } };
      yield { type: 'result', subtype: 'success', session_id: 'sess-1' };
    };

    const events = await collect(
      runQuery({
        prompt: 'hi',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );

    expect(events[0]).toMatchObject({ type: 'session-init', sessionId: 'sess-1' });
    expect(events.some((e) => e.type === 'assistant-text' && e.text === 'Hello')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', sessionId: 'sess-1' });
  });

  it('records tool_results and emits citations on [N] markers', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-2' };
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'slack_search', input: { query: 'andre' } }],
        },
      };
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: JSON.stringify([{ title: 'A msg', snippet: 'andre said x', author: 'andre' }]),
            },
          ],
        },
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Andre said X [1]' }] },
      };
      yield { type: 'result', subtype: 'success', session_id: 'sess-2' };
    };

    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );

    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toBeDefined();
    if (toolResult && toolResult.type === 'tool-result') {
      expect(toolResult.sourceIndex).toBe(1);
      expect(toolResult.tool).toBe('slack_search');
    }

    const citation = events.find((e) => e.type === 'citation');
    expect(citation).toBeDefined();

    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.sources.length).toBe(1);
      expect(done.finalAnswer).toContain('Andre said X [1]');
    }
  });

  it('emits error event when queryFn throws', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-3' };
      throw new Error('boom');
    };
    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.message).toContain('boom');
  });

  it('emits done when iterator completes naturally without a result event', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-4' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'final' }] } };
    };
    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.sessionId).toBe('sess-4');
      expect(last.finalAnswer).toContain('final');
    }
  });

  it('handles array-form tool_result content (MCP-style)', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-arr' };
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't-arr', name: 'slack_search', input: { query: 'x' } }],
        },
      };
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't-arr',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify([{ title: 'Array msg', snippet: 'from array form', author: 'a' }]),
                },
              ],
            },
          ],
        },
      };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Array done [1]' }] } };
      yield { type: 'result', subtype: 'success', session_id: 'sess-arr' };
    };

    const events = await collect(
      runQuery({
        prompt: 'q',
        config: baseConfig,
        scryConfigDir: '/tmp/scry',
        queryFn: fakeQuery as never,
      }),
    );

    const tr = events.find((e) => e.type === 'tool-result');
    expect(tr).toBeDefined();
    if (tr && tr.type === 'tool-result') {
      expect(tr.source.title).toBe('Array msg');
      expect(tr.source.snippet).toBe('from array form');
    }
  });

  it('emits sources-finalized after final assistant text and before done', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-fin' };
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'slack_search', input: {} }],
        },
      };
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: JSON.stringify([{ title: 'Andre', snippet: 'x' }]),
            },
          ],
        },
      };
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: 'Andre said X [1].\n\nSources:\n[1] Slack: Andre msg (https://slack.com/x)',
            },
          ],
        },
      };
      yield { type: 'result', subtype: 'success', session_id: 'sess-fin' };
    };

    const events: RunQueryEvent[] = [];
    for await (const e of runQuery({
      prompt: 'q',
      config: baseConfig,
      scryConfigDir: '/tmp/scry',
      queryFn: fakeQuery as never,
    })) {
      events.push(e);
    }

    const finalIdx = events.findIndex((e) => e.type === 'sources-finalized');
    const doneIdx = events.findIndex((e) => e.type === 'done');
    const lastTextIdx = events.map((e) => e.type).lastIndexOf('assistant-text');

    expect(finalIdx).toBeGreaterThan(lastTextIdx);
    expect(doneIdx).toBe(finalIdx + 1);

    if (events[finalIdx].type === 'sources-finalized') {
      expect(events[finalIdx].sources.length).toBe(1);
      expect(events[finalIdx].sources[0].url).toBe('https://slack.com/x');
    }
  });

  it('does NOT emit sources-finalized when answer has no Sources block', async () => {
    const fakeQuery = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'sess-no-sources' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'plain answer no enumeration' }] } };
      yield { type: 'result', subtype: 'success', session_id: 'sess-no-sources' };
    };
    const events: RunQueryEvent[] = [];
    for await (const e of runQuery({
      prompt: 'q',
      config: baseConfig,
      scryConfigDir: '/tmp/scry',
      queryFn: fakeQuery as never,
    })) {
      events.push(e);
    }
    expect(events.find((e) => e.type === 'sources-finalized')).toBeUndefined();
    expect(events[events.length - 1].type).toBe('done');
  });
});
