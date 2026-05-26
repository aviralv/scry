// src/engine/runQuery.ts
// Wraps @anthropic-ai/claude-agent-sdk's query() async iterable, dispatching
// SDK messages into typed RunQueryEvents that the CLI and (later) the web
// server consume.
//
// SDK message types dispatched on (verified in node_modules during T1):
//   - 'system' + subtype 'init'         → session-init
//   - 'assistant' (message.content[])   → walk text + tool_use blocks
//   - 'user'      (message.content[])   → walk tool_result blocks
//   - 'result'                          → done
//   (any other message types are silently ignored)

import { query as realQuery } from '@anthropic-ai/claude-agent-sdk';
import { join } from 'path';
import { loadDotEnvFile } from '../config/dotenv.js';
import type { McpServerConfig } from '../config/types.js';
import type { RunQueryOptions, RunQueryEvent, SourceCard } from './types.js';
import { buildSystemPrompt } from './system-prompt.js';
import { SourceTracker } from './source-tracker.js';
import { parseSources } from './parse-sources.js';

export interface RunQueryInternalOptions extends RunQueryOptions {
  /** Dependency-inject a fake query function for tests. */
  queryFn?: typeof realQuery;
}

export async function* runQuery(opts: RunQueryInternalOptions): AsyncIterable<RunQueryEvent> {
  // 1. Load .scry.env so the SDK sees ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL.
  loadDotEnvFile(join(opts.scryConfigDir, '.scry.env'));

  // 2. Build system prompt + mcpServers map.
  const systemPrompt = buildSystemPrompt({
    registry: opts.config.registry ?? { people: {}, projects: {} },
    fanoutMode: opts.fanoutMode ?? false,
    serverNames: Object.keys(opts.config.mcp_servers),
  });
  const mcpServers = buildMcpServers(opts.config.mcp_servers);

  // 3. Set up abort.
  const abortController = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort();
    else opts.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  // 4. tool_use_id → { tool, server } correlation. tool_result blocks reference
  // tool_use_id from a prior assistant message; we look up here to attribute
  // the source card correctly.
  const toolUseMap = new Map<string, { tool: string; server: string }>();
  const tracker = new SourceTracker(opts.priorSources ?? []);

  // 5. Build allowedTools — restrict Claude to ONLY the configured search
  // tools. This blocks Claude Code's built-ins (Task, Bash, Read, Edit, etc.)
  // so the agent can't spawn subagents or touch the filesystem; it can only
  // call the MCP tools the user has explicitly listed in scry.config.yaml.
  const allowedTools = Object.entries(opts.config.search_tools).flatMap(
    ([server, tools]) => tools.map((t) => `mcp__${server}__${t.tool}`),
  );

  // 6. Call SDK (or injected fake).
  const queryFn = opts.queryFn ?? realQuery;
  const stream = queryFn({
    prompt: opts.prompt,
    options: {
      systemPrompt,
      mcpServers,
      cwd: opts.scryConfigDir,
      resume: opts.resume,
      abortController,
      // Headless: no UI to approve permission prompts. The user has
      // already authorized these MCPs by configuring them in scry.config.yaml.
      // Combined with the allowedTools restriction above, the bypass is
      // bounded to exactly the configured search tools.
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools,
    } as never, // SDK option type is wide; conservative cast
  });

  let sessionId = '';
  let finalAnswer = '';

  try {
    for await (const msg of stream as AsyncIterable<unknown>) {
      const m = msg as Record<string, unknown>;

      if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
        sessionId = m.session_id;
        yield { type: 'session-init', sessionId };
        continue;
      }

      if (m.type === 'assistant') {
        const content = ((m.message as { content?: unknown[] })?.content) ?? [];
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string') {
            finalAnswer = (finalAnswer ? finalAnswer + '\n' : '') + block.text;
            yield { type: 'assistant-text', text: block.text };
            for (const cit of tracker.validateMarkers(block.text)) {
              const card = tracker.sources.find((s) => s.index === cit.index)!;
              yield { type: 'citation', index: cit.index, source: card };
            }
          } else if (block.type === 'tool_use' && typeof block.id === 'string') {
            const toolName = (block.name as string) ?? 'unknown';
            const server = serverForTool(toolName, opts.config.search_tools);
            toolUseMap.set(block.id, { tool: toolName, server });
            yield { type: 'tool-call', tool: toolName, args: block.input ?? {} };
          }
        }
        continue;
      }

      if (m.type === 'user') {
        const content = ((m.message as { content?: unknown[] })?.content) ?? [];
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            const meta = toolUseMap.get(block.tool_use_id) ?? { tool: 'unknown', server: 'unknown' };
            const card = parseToolResult(block, meta, tracker);
            if (card) {
              yield { type: 'tool-result', tool: card.tool, sourceIndex: card.index, source: card };
            }
          }
        }
        continue;
      }

      if (m.type === 'result') {
        const sid = typeof m.session_id === 'string' ? m.session_id : sessionId;
        yield* finalize(sid);
        return;
      }
      // Any other message type: ignore.
    }
    // Stream ended without `result`.
    yield* finalize(sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message };
  }

  function* finalize(sid: string): Generator<RunQueryEvent> {
    const parsed = parseSources(finalAnswer);
    if (parsed.length > 0) {
      // Replace the in-memory tracker list with canonical sources from Claude's enumeration.
      // The parsed list is what the GUI uses; the streaming arrival-order list was only for
      // progress UI and is now superseded.
      yield { type: 'sources-finalized', sources: parsed };
      yield { type: 'done', sessionId: sid, sources: parsed, finalAnswer };
    } else {
      // No parseable enumeration — fall back to streaming arrival-order list.
      yield { type: 'done', sessionId: sid, sources: tracker.sources, finalAnswer };
    }
  }
}

// --- helpers ---

function buildMcpServers(
  servers: Record<string, McpServerConfig>,
): Record<string, { command: string; args?: string[]; env?: Record<string, string> }> {
  const out: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    out[name] = {
      command: cfg.command,
      args: cfg.args,
      env: cfg.env as Record<string, string> | undefined,
    };
  }
  return out;
}

function serverForTool(
  toolName: string,
  searchTools: Record<string, Array<{ tool: string }>>,
): string {
  for (const [server, tools] of Object.entries(searchTools)) {
    if (tools.some((t) => t.tool === toolName)) return server;
  }
  return 'unknown';
}

function parseToolResult(
  block: Record<string, unknown>,
  meta: { tool: string; server: string },
  tracker: SourceTracker,
): SourceCard | null {
  const raw = block.content;
  let payload: { title?: string; snippet?: string; author?: string; timestamp?: string; url?: string } = {};

  // Normalize array-form content. MCP servers commonly return
  // Array<{ type: 'text', text: string }>. Most servers send a single
  // text block per tool_result; we take the first block to avoid
  // joining multiple JSON-formatted blocks into invalid JSON. When
  // multiple blocks exist, only the first is used — that's a known
  // limitation; downstream consumers should paginate via tool args
  // rather than expecting multi-block parsing here.
  let asString: string | null = null;
  if (typeof raw === 'string') {
    asString = raw;
  } else if (Array.isArray(raw)) {
    const firstText = raw.find(
      (b): b is { type: string; text: string } =>
        b !== null &&
        typeof b === 'object' &&
        (b as Record<string, unknown>).type === 'text' &&
        typeof (b as Record<string, unknown>).text === 'string',
    );
    asString = firstText ? firstText.text : null;
  }

  if (asString !== null) {
    try {
      const parsed = JSON.parse(asString);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      payload = first ?? {};
    } catch {
      payload = { title: 'tool result', snippet: asString.slice(0, 200) };
    }
  }

  return tracker.recordToolResult(meta.server, meta.tool, {
    title: payload.title ?? 'untitled',
    snippet: payload.snippet ?? '',
    url: payload.url,
    author: payload.author,
    timestamp: payload.timestamp,
    raw,
  });
}
