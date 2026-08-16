// src/engine/mcp-client.ts
// Manages MCP server connections for the engine. Spawns child processes,
// lists available tools, and executes tool calls on demand.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from '../config/types.js';
import type { ToolDef } from './providers/types.js';

export interface McpConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: ToolDef[];
}

/**
 * Connect to all configured MCP servers. Returns connections with their
 * available tools listed. Skips servers that fail to connect (logs warning).
 */
export async function connectMcpServers(
  servers: Record<string, McpServerConfig>,
  options?: { signal?: AbortSignal },
): Promise<McpConnection[]> {
  const connections: McpConnection[] = [];

  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.enabled === false) continue;

    try {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
      });

      const client = new Client({
        name: `scry-${name}`,
        version: '0.3.0',
      });

      await client.connect(transport);

      // List available tools from this server.
      let tools: ToolDef[];
      try {
        const toolsResult = await client.listTools();
        tools = (toolsResult.tools ?? []).map((t) => ({
          name: `${name}__${t.name}`,
          description: t.description ?? '',
          inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        }));
      } catch (listErr) {
        // listTools failed after connect — close to avoid orphaned subprocess.
        try { await client.close(); } catch { /* best effort */ }
        throw listErr;
      }

      connections.push({ name, client, transport, tools });
    } catch (err) {
      console.warn(`scry: failed to connect MCP server "${name}" (${cfg.command}): ${(err as Error).message}`);
    }
  }

  return connections;
}

/**
 * Call a tool on the appropriate MCP connection. The tool name is prefixed
 * with the server name (e.g., "slack__slack_search"). This function strips
 * the prefix and routes to the correct server.
 */
export async function callTool(
  connections: McpConnection[],
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  const [serverName, ...rest] = toolName.split('__');
  const mcpToolName = rest.join('__');
  const conn = connections.find((c) => c.name === serverName);
  if (!conn) {
    return JSON.stringify({ error: `No connection for server "${serverName}"` });
  }

  try {
    const result = await conn.client.callTool({ name: mcpToolName, arguments: input });
    // MCP tool results come as content arrays. Extract text.
    const content = result.content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is { type: string; text: string } => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
    }
    return typeof content === 'string' ? content : JSON.stringify(content);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

/**
 * Disconnect all MCP servers gracefully.
 */
export async function disconnectAll(connections: McpConnection[]): Promise<void> {
  await Promise.allSettled(
    connections.map(async (c) => {
      try { await c.client.close(); } catch { /* best effort */ }
    }),
  );
}
