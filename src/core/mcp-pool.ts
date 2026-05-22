import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from '../config/types.js';
import { raceAbort } from './abort.js';

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Call timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

interface ServerConnection {
  name: string;
  client: Client;
  tools: string[];
}

export class McpPool {
  private connections: Map<string, ServerConnection> = new Map();
  private toolToServer: Map<string, string> = new Map();

  async connect(servers: Record<string, McpServerConfig>): Promise<void> {
    const connectPromises = Object.entries(servers).map(
      ([name, config]) => this.connectOne(name, config)
    );
    await Promise.allSettled(connectPromises);
  }

  private async connectOne(name: string, config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    });

    const client = new Client(
      { name: 'scry', version: '0.1.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);

    this.connections.set(name, { name, client, tools: toolNames });
    for (const tool of toolNames) {
      this.toolToServer.set(tool, name);
    }
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number = 15000,
    signal?: AbortSignal,
  ): Promise<string> {
    const serverName = this.toolToServer.get(toolName);
    if (!serverName) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`Server ${serverName} not connected`);
    }

    const result = await raceAbort(
      withTimeout(
        conn.client.callTool({ name: toolName, arguments: args }),
        timeoutMs
      ),
      signal,
    );
    const texts: string[] = [];
    for (const block of result.content as Array<{ type: string; text?: string }>) {
      if (block.type === 'text' && block.text) {
        texts.push(block.text);
      }
    }
    return texts.join('\n');
  }

  getAvailableTools(): string[] {
    return [...this.toolToServer.keys()];
  }

  async shutdown(): Promise<void> {
    for (const conn of this.connections.values()) {
      await conn.client.close();
    }
    this.connections.clear();
    this.toolToServer.clear();
  }
}
