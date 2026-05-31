#!/usr/bin/env node
// Minimal MCP stdio server: handles initialize + tools/list. Lists 2 tools.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-ok', version: '0.0.0' },
    }});
  } else if (msg.method === 'notifications/initialized') {
    // no response
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      tools: [
        { name: 'tool_a', description: '', inputSchema: { type: 'object' } },
        { name: 'tool_b', description: '', inputSchema: { type: 'object' } },
      ],
    }});
  }
});
