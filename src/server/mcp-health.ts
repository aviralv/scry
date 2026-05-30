import { spawn } from 'child_process';
import type { McpServerConfig } from '../config/types.js';

export interface HealthCheckOk { ok: true; toolCount: number; toolName?: string }
export interface HealthCheckErr { ok: false; error: string }
export type HealthCheckResult = HealthCheckOk | HealthCheckErr;

export interface HealthCheckOpts { timeoutMs?: number }

const ENV_REF_RE = /^\$\{([A-Z][A-Z0-9_]*)\}$/;

/**
 * Resolve env values *only* for refs naming a key declared in the same entry's
 * env block. A ref to anything else passes through unresolved (literal
 * "${NAME}"). A safe-literal value passes through unchanged.
 *
 * This is the security boundary, not the regex in the schema. The schema only
 * validates value *shape*; the allowlist enforces what can actually leave
 * scry's environment for the child.
 */
export function resolveDeclaredEnv(entryEnv: Record<string, string>): Record<string, string> {
  const declaredKeys = new Set(Object.keys(entryEnv));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entryEnv)) {
    const m = ENV_REF_RE.exec(v);
    if (m && declaredKeys.has(m[1])) {
      // The ref names a key in this same entry — resolve from process.env.
      out[k] = process.env[m[1]] ?? '';
    } else {
      // Either a safe-literal, or a ref to a non-declared name. Pass through.
      out[k] = v;
    }
  }
  return out;
}

/**
 * Spawn the MCP child with its own process group, JSON-RPC initialize +
 * tools/list, then close. Timeout via Promise.race; on timeout, kill the
 * child's PGID with SIGTERM then SIGKILL after 200ms.
 */
export async function healthCheck(server: McpServerConfig, opts: HealthCheckOpts = {}): Promise<HealthCheckResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...resolveDeclaredEnv(server.env ?? {}),
  };

  const child = spawn(server.command, server.args ?? [], {
    detached: true,                  // setsid() on POSIX → own PGID
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Reject child.pid==null (rare; happens when spawn fails synchronously).
  if (child.pid == null) {
    return { ok: false, error: 'failed to spawn child process' };
  }
  const pgid = child.pid;

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const killPgid = (sig: NodeJS.Signals) => {
    try { process.kill(-pgid, sig); } catch { /* already dead */ }
  };

  let settled = false;
  const settle = (r: HealthCheckResult): HealthCheckResult => {
    if (settled) return r;
    settled = true;
    killPgid('SIGTERM');
    setTimeout(() => killPgid('SIGKILL'), 200).unref();
    return r;
  };

  const exitPromise = new Promise<HealthCheckResult>((resolveExit) => {
    child.once('exit', (code, signal) => {
      if (settled) return;
      resolveExit(settle({ ok: false, error: `child exited (code=${code} signal=${signal}) ${stderr.trim()}`.trim() }));
    });
    child.once('error', (err) => {
      if (settled) return;
      resolveExit(settle({ ok: false, error: err.message }));
    });
  });

  const timeoutPromise = new Promise<HealthCheckResult>((resolveTimeout) => {
    setTimeout(() => {
      resolveTimeout(settle({ ok: false, error: `MCP server did not respond within ${timeoutMs}ms (timeout)` }));
    }, timeoutMs).unref();
  });

  const protocolPromise: Promise<HealthCheckResult> = (async () => {
    try {
      // Send initialize.
      const initId = 1;
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: initId, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scry-health', version: '0' } },
      }) + '\n');
      await readJsonResponse(child, initId);
      // Send initialized notification.
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      // Send tools/list.
      const listId = 2;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} }) + '\n');
      const listResp = await readJsonResponse(child, listId);
      const tools = (listResp?.result?.tools ?? []) as Array<{ name: string }>;
      return settle({ ok: true, toolCount: tools.length, toolName: tools[0]?.name });
    } catch (err) {
      return settle({ ok: false, error: (err as Error).message });
    }
  })();

  return Promise.race([protocolPromise, exitPromise, timeoutPromise]);
}

/**
 * Read newline-delimited JSON-RPC responses from the child's stdout until a
 * response with the given id arrives. Buffers across line boundaries.
 */
function readJsonResponse(
  child: import('child_process').ChildProcessByStdio<NodeJS.WritableStream, NodeJS.ReadableStream, NodeJS.ReadableStream>,
  id: number,
): Promise<{ result?: { tools?: { name: string }[] }; error?: unknown }> {
  return new Promise((resolveRead, rejectRead) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            child.stdout.off('data', onData);
            resolveRead(msg);
            return;
          }
        } catch {
          // ignore non-JSON noise
        }
      }
    };
    child.stdout.on('data', onData);
    child.stdout.once('error', rejectRead);
  });
}
