import { describe, it, expect, vi } from 'vitest';
import { McpPool } from '../../src/core/mcp-pool.js';
import type { McpServerConfig } from '../../src/config/types.js';

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'slack_search', description: 'Search Slack', inputSchema: {} },
          { name: 'slack_channel_history', description: 'Read history', inputSchema: {} },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"results": []}' }],
      }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  return {
    StdioClientTransport: vi.fn().mockImplementation(() => ({})),
  };
});

describe('McpPool', () => {
  it('connects to configured servers and discovers tools', async () => {
    const pool = new McpPool();
    const servers: Record<string, McpServerConfig> = {
      slack: { command: 'slack-mcp' },
    };

    await pool.connect(servers);

    expect(pool.getAvailableTools()).toContain('slack_search');
    expect(pool.getAvailableTools()).toContain('slack_channel_history');
  });

  it('routes tool calls to the correct server', async () => {
    const pool = new McpPool();
    await pool.connect({ slack: { command: 'slack-mcp' } });

    const result = await pool.callTool('slack_search', { query: 'test' });
    expect(result).toBe('{"results": []}');
  });

  it('throws on unknown tool', async () => {
    const pool = new McpPool();
    await pool.connect({ slack: { command: 'slack-mcp' } });

    await expect(pool.callTool('nonexistent_tool', {})).rejects.toThrow('Unknown tool');
  });

  it('shuts down all connections', async () => {
    const pool = new McpPool();
    await pool.connect({ slack: { command: 'slack-mcp' } });
    await pool.shutdown();

    expect(pool.getAvailableTools()).toHaveLength(0);
  });
});
