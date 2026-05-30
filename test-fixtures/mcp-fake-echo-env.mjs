#!/usr/bin/env node
// Lists one tool whose name is the comma-joined sorted env var keys, so the
// caller can assert the allowlist by reading the tool name.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const keys = Object.keys(process.env).sort().join(',');
rl.on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'echo-env', version: '0.0.0' },
    }});
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      tools: [{ name: keys.slice(0, 250) || 'EMPTY', description: '', inputSchema: { type: 'object' } }],
    }});
  }
});
