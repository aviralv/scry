// src/engine/runQuery.ts
// Provider-agnostic agentic loop. Replaces the Claude Agent SDK with
// direct LLM API calls + MCP tool execution. Supports any provider that
// implements the Provider interface.

import type { McpServerConfig, LlmProvider, Registry, SearchToolConfig } from '../config/types.js';
import type { RunQueryOptions, RunQueryEvent, SourceCard } from './types.js';
import { buildSystemPrompt } from './system-prompt.js';
import { SourceTracker } from './source-tracker.js';
import { parseSources } from './parse-sources.js';
import { getProvider } from './providers/index.js';
import type { Provider, Message, ToolUseBlock, ProviderEvent, ToolDef } from './providers/types.js';
import { connectMcpServers, callTool, disconnectAll, type McpConnection } from './mcp-client.js';
import { parseEnvRef } from '../config/env-ref.js';

export interface RunQueryInternalOptions extends RunQueryOptions {
  /** Dependency-inject fake MCP connections for tests. */
  mcpConnections?: McpConnection[];
  /** Dependency-inject a fake provider for tests. */
  providerOverride?: Provider;
}

const MAX_TOOL_TURNS = 10;

export async function* runQuery(opts: RunQueryInternalOptions): AsyncIterable<RunQueryEvent> {
  const provider = opts.providerOverride ?? getProvider((opts.config.llm.provider as LlmProvider) ?? 'anthropic');
  const registry = opts.config.registry ?? { people: {}, projects: {} };
  const fanoutMode = opts.fanoutMode ?? true;

  // Build system prompt.
  const systemPrompt = buildSystemPrompt({
    registry,
    fanoutMode,
    serverNames: Object.keys(opts.config.mcp_servers),
  });

  // Resolve auth token from env refs.
  const rawToken = opts.config.llm.auth_token;
  let apiKey: string | null = null;
  if (rawToken) {
    const refName = parseEnvRef(rawToken);
    if (refName) {
      apiKey = process.env[refName] ?? null;
    } else {
      apiKey = rawToken;
    }
  }

  // Connect to MCP servers (or use injected connections).
  let connections: McpConnection[];
  let ownedConnections = false;
  if (opts.mcpConnections) {
    connections = opts.mcpConnections;
  } else {
    // Resolve env refs in server configs before connecting.
    const resolvedServers = resolveServerEnv(opts.config.mcp_servers);
    connections = await connectMcpServers(resolvedServers, { signal: opts.signal });
    ownedConnections = true;
  }

  // Gather all available tools from connected MCP servers.
  const allTools = connections.flatMap((c) => c.tools);

  // Generate a session ID.
  const sessionId = crypto.randomUUID();
  yield { type: 'session-init', sessionId };

  // Build conversation messages.
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: opts.prompt },
  ];

  const tracker = new SourceTracker([]);
  let finalAnswer = '';

  try {
    if (fanoutMode) {
      const plannedSearches = buildConfiguredSearchCalls({
        prompt: opts.prompt,
        registry,
        searchTools: opts.config.search_tools ?? {},
        availableTools: allTools,
      });

      if (plannedSearches.length > 0) {
        const syntheticToolUses: ToolUseBlock[] = plannedSearches.map((search) => ({
          type: 'tool_use',
          id: crypto.randomUUID(),
          name: search.prefixedToolName,
          input: search.input,
        }));

        messages.push({ role: 'assistant', content: syntheticToolUses });

        for (const search of plannedSearches) {
          yield { type: 'tool-call', tool: search.prefixedToolName, args: search.input };
        }

        const toolResults = await Promise.all(
          syntheticToolUses.map(async (tc) => {
            const result = await callTool(connections, tc.name, tc.input);
            return { tc, result };
          }),
        );

        for (const { tc, result } of toolResults) {
          messages.push({ role: 'tool', toolUseId: tc.id, content: result });

          const serverName = tc.name.split('__')[0];
          const card = parseToolResultForCard(result, serverName, tc.name, tracker);
          if (card) {
            yield { type: 'tool-result', tool: tc.name, sourceIndex: card.index, source: card };
          }
        }
      }
    }

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      // Call LLM.
      const assistantBlocks: Array<{ type: 'text'; text: string } | ToolUseBlock> = [];
      let turnText = '';
      const pendingToolCalls: ToolUseBlock[] = [];
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

      const stream = provider.chat(messages, allTools, {
        baseUrl: opts.config.llm.base_url,
        apiKey,
        model: opts.config.llm.model,
        signal: opts.signal,
      });

      for await (const event of stream) {
        if (opts.signal?.aborted) break;

        switch (event.type) {
          case 'text_delta':
            turnText += event.text;
            yield { type: 'assistant-text', text: event.text };
            break;
          case 'tool_use_start':
            yield { type: 'tool-call', tool: event.name, args: {} };
            break;
          case 'tool_use_end':
            pendingToolCalls.push({
              type: 'tool_use',
              id: event.id,
              name: event.name,
              input: event.input,
            });
            break;
          case 'done':
            stopReason = event.stopReason;
            break;
        }
      }

      if (opts.signal?.aborted) break;

      // Build assistant message from this turn.
      if (turnText) {
        assistantBlocks.push({ type: 'text', text: turnText });
        finalAnswer += (finalAnswer ? '\n' : '') + turnText;
      }
      for (const tc of pendingToolCalls) {
        assistantBlocks.push(tc);
      }
      messages.push({ role: 'assistant', content: assistantBlocks });

      // If no tool calls, we're done.
      if (stopReason !== 'tool_use' || pendingToolCalls.length === 0) {
        break;
      }

      // Execute tool calls in parallel and feed results back.
      const toolResults = await Promise.all(
        pendingToolCalls.map(async (tc) => {
          const result = await callTool(connections, tc.name, tc.input);
          return { tc, result };
        }),
      );
      for (const { tc, result } of toolResults) {
        messages.push({ role: 'tool', toolUseId: tc.id, content: result });

        // Track source card.
        const serverName = tc.name.split('__')[0];
        const card = parseToolResultForCard(result, serverName, tc.name, tracker);
        if (card) {
          yield { type: 'tool-result', tool: tc.name, sourceIndex: card.index, source: card };
        }
      }
    }
  } catch (err) {
    // AbortError = user cancelled — silent stop, not an error event.
    if (err instanceof Error && (err.name === 'AbortError' || opts.signal?.aborted)) {
      // Don't yield error — the caller already knows they aborted.
    } else {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message };
    }
  } finally {
    if (ownedConnections) {
      await disconnectAll(connections);
    }
  }

  // Finalize sources. Merge parsed titles (from LLM's Sources: block)
  // with URLs from tracker cards (from MCP tool results). The LLM gives
  // clean titles and proper attribution; the tracker has the actual URLs
  // from tool results (e.g., Slack permalinks). Best of both.
  const parsed = parseSources(finalAnswer);
  if (parsed.length > 0) {
    const merged = mergeParsedSourcesWithTracker(parsed, tracker.sources);
    yield { type: 'sources-finalized', sources: merged };
    yield { type: 'done', sessionId, sources: merged, finalAnswer };
  } else {
    yield { type: 'done', sessionId, sources: tracker.sources, finalAnswer };
  }
}

// --- helpers ---

function resolveServerEnv(
  servers: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.enabled === false) continue;
    const resolvedEnv: Record<string, string> = {};
    if (cfg.env) {
      for (const [k, v] of Object.entries(cfg.env)) {
        const ref = parseEnvRef(v);
        resolvedEnv[k] = ref ? (process.env[ref] ?? '') : v;
      }
    }
    out[name] = { ...cfg, env: resolvedEnv };
  }
  return out;
}

interface ConfiguredSearchCall {
  prefixedToolName: string;
  input: Record<string, unknown>;
}

function buildConfiguredSearchCalls(opts: {
  prompt: string;
  registry: Registry;
  searchTools: Record<string, SearchToolConfig[]>;
  availableTools: ToolDef[];
}): ConfiguredSearchCall[] {
  const availableByName = new Map(opts.availableTools.map((tool) => [tool.name, tool]));
  const calls: ConfiguredSearchCall[] = [];

  for (const [serverName, tools] of Object.entries(opts.searchTools)) {
    for (const toolConfig of tools) {
      const prefixedToolName = `${serverName}__${toolConfig.tool}`;
      const toolDef = availableByName.get(prefixedToolName);
      if (!toolDef) continue;

      calls.push({
        prefixedToolName,
        input: buildSearchInput({
          prompt: opts.prompt,
          registry: opts.registry,
          serverName,
          toolName: toolConfig.tool,
          params: toolConfig.params ?? {},
          inputSchema: toolDef.inputSchema,
        }),
      });
    }
  }

  return calls;
}

function buildSearchInput(opts: {
  prompt: string;
  registry: Registry;
  serverName: string;
  toolName: string;
  params: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  const input: Record<string, unknown> = { ...opts.params };
  const properties = schemaProperties(opts.inputSchema);
  const enrichedQuery = enrichQueryWithRegistry(opts.prompt, opts.registry, opts.serverName);

  setFirstSupportedInput(input, properties, ['query', 'q', 'search', 'text'], enrichedQuery);

  const routing = registryRoutingHints(opts.prompt, opts.registry);
  if (routing.slackChannels.length > 0 && serverLooksLike(opts.serverName, opts.toolName, 'slack')) {
    setFirstSupportedInput(input, properties, ['channels', 'channel_ids', 'slack_channels'], routing.slackChannels);
  }
  if (routing.jiraProjects.length > 0 && serverLooksLike(opts.serverName, opts.toolName, 'jira')) {
    setFirstSupportedInput(input, properties, ['project', 'project_key', 'jira_project'], routing.jiraProjects[0]);
  }
  if (routing.confluenceCql.length > 0 && serverLooksLike(opts.serverName, opts.toolName, 'confluence')) {
    setFirstSupportedInput(input, properties, ['cql', 'confluence_cql'], routing.confluenceCql.join(' OR '));
  }

  return input;
}

function schemaProperties(inputSchema: Record<string, unknown>): Set<string> | null {
  const props = inputSchema.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  return new Set(Object.keys(props));
}

function setFirstSupportedInput(
  input: Record<string, unknown>,
  properties: Set<string> | null,
  keys: string[],
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (keys.some((key) => input[key] !== undefined)) return;

  const key = properties
    ? keys.find((candidate) => properties.has(candidate))
    : keys[0];
  if (key) input[key] = value;
}

function enrichQueryWithRegistry(prompt: string, registry: Registry, serverName: string): string {
  const hints = registryQueryHints(prompt, registry, serverName);
  if (hints.length === 0) return prompt;
  return `${prompt} ${hints.join(' ')}`;
}

function registryQueryHints(prompt: string, registry: Registry, serverName: string): string[] {
  const promptNorm = normalizeForMatch(prompt);
  const serverNorm = normalizeForMatch(serverName);
  const hints = new Set<string>();

  for (const [key, person] of Object.entries(registry.people ?? {})) {
    if (!entityMatches(promptNorm, [key, person.name, ...(person.aliases ?? [])])) continue;
    if (person.identifiers.email) hints.add(person.identifiers.email);
    if (serverNorm.includes('slack') && person.identifiers.slack_username) hints.add(person.identifiers.slack_username);
    if (serverNorm.includes('confluence') && person.identifiers.confluence_username) hints.add(person.identifiers.confluence_username);
  }

  for (const [key, project] of Object.entries(registry.projects ?? {})) {
    if (!entityMatches(promptNorm, [key, project.name, ...(project.aliases ?? [])])) continue;
    for (const channel of project.routing.slack_channels ?? []) hints.add(channel);
    if (project.routing.jira_project) hints.add(project.routing.jira_project);
    if (project.routing.confluence_cql) hints.add(project.routing.confluence_cql);
  }

  return [...hints];
}

function registryRoutingHints(prompt: string, registry: Registry): {
  slackChannels: string[];
  jiraProjects: string[];
  confluenceCql: string[];
} {
  const promptNorm = normalizeForMatch(prompt);
  const slackChannels = new Set<string>();
  const jiraProjects = new Set<string>();
  const confluenceCql = new Set<string>();

  for (const [key, project] of Object.entries(registry.projects ?? {})) {
    if (!entityMatches(promptNorm, [key, project.name, ...(project.aliases ?? [])])) continue;
    for (const channel of project.routing.slack_channels ?? []) slackChannels.add(channel);
    if (project.routing.jira_project) jiraProjects.add(project.routing.jira_project);
    if (project.routing.confluence_cql) confluenceCql.add(project.routing.confluence_cql);
  }

  return {
    slackChannels: [...slackChannels],
    jiraProjects: [...jiraProjects],
    confluenceCql: [...confluenceCql],
  };
}

function entityMatches(promptNorm: string, names: Array<string | undefined>): boolean {
  return names.some((name) => {
    const norm = normalizeForMatch(name);
    return norm.length > 0 && promptNorm.includes(norm);
  });
}

function serverLooksLike(serverName: string, toolName: string, needle: string): boolean {
  const haystack = normalizeForMatch(`${serverName} ${toolName}`);
  return haystack.includes(needle);
}

function parseToolResultForCard(
  raw: string,
  serverName: string,
  toolName: string,
  tracker: SourceTracker,
): SourceCard | null {
  let payload: { title?: string; snippet?: string; author?: string; timestamp?: string; url?: string } = {};

  // Strip MCP untrusted content markers if present.
  let cleaned = raw;
  const beginMarker = cleaned.match(/\[BEGIN UNTRUSTED CONTENT FROM [^\]]+\]\n?/);
  if (beginMarker) cleaned = cleaned.slice(beginMarker.index! + beginMarker[0].length);
  const endMarker = cleaned.match(/\n?\[END UNTRUSTED CONTENT[^\]]*\]/);
  if (endMarker) cleaned = cleaned.slice(0, endMarker.index);

  try {
    const parsed = JSON.parse(cleaned.trim());
    payload = payloadFromParsedResult(parsed);
  } catch {
    payload = { title: 'tool result', snippet: raw.slice(0, 200) };
  }

  return tracker.recordToolResult(serverName, toolName, {
    title: payload.title ?? 'untitled',
    snippet: payload.snippet ?? '',
    url: payload.url,
    author: payload.author,
    timestamp: payload.timestamp,
  });
}

function mergeParsedSourcesWithTracker(parsed: SourceCard[], tracked: SourceCard[]): SourceCard[] {
  const usedTrackedIndexes = new Set<number>();

  return parsed.map((card) => {
    if (card.url) return card;

    const match = findBestTrackerMatch(card, tracked, usedTrackedIndexes);
    if (match?.url) {
      usedTrackedIndexes.add(match.index);
      return { ...card, url: match.url };
    }

    return card;
  });
}

function findBestTrackerMatch(
  card: SourceCard,
  tracked: SourceCard[],
  usedTrackedIndexes: Set<number>,
): SourceCard | undefined {
  let best: { card: SourceCard; score: number } | undefined;

  for (const candidate of tracked) {
    if (usedTrackedIndexes.has(candidate.index) || !candidate.url) continue;
    const score = sourceMatchScore(card, candidate) + textMatchScore(card.title, candidate.title, candidate.snippet);
    if (!best || score > best.score) best = { card: candidate, score };
  }

  if (best && best.score >= 35) return best.card;

  const sameIndex = tracked.find((candidate) =>
    !usedTrackedIndexes.has(candidate.index) && candidate.url && candidate.index === card.index,
  );
  return sameIndex;
}

function sourceMatchScore(parsed: SourceCard, tracked: SourceCard): number {
  const parsedSource = normalizeForMatch(parsed.source);
  const trackedSource = normalizeForMatch(tracked.source);
  const trackedTool = normalizeForMatch(tracked.tool);

  if (!parsedSource || !trackedSource) return 0;
  if (parsedSource === trackedSource) return 50;
  if (parsedSource.includes(trackedSource) || trackedSource.includes(parsedSource)) return 40;
  if (trackedTool.includes(parsedSource)) return 30;
  return 0;
}

function textMatchScore(parsedTitle: string, trackedTitle: string, trackedSnippet: string): number {
  const parsedTokens = significantTokens(parsedTitle);
  if (parsedTokens.length === 0) return 0;

  const trackedText = significantTokens(`${trackedTitle} ${trackedSnippet}`);
  if (trackedText.length === 0) return 0;

  const trackedSet = new Set(trackedText);
  const overlap = parsedTokens.filter((token) => trackedSet.has(token)).length;
  return Math.round((overlap / parsedTokens.length) * 50);
}

function significantTokens(text: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'from', 'with', 'that', 'this', 'into', 'about']);
  return normalizeForMatch(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function normalizeForMatch(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function payloadFromParsedResult(parsed: unknown): {
  title?: string;
  snippet?: string;
  author?: string;
  timestamp?: string;
  url?: string;
} {
  const first = firstResultObject(parsed);
  if (!first) return {};

  const title = pickString(first, ['title', 'name', 'subject', 'channel_name', 'summary']) ?? 'untitled';
  const snippet = pickString(first, ['snippet', 'text', 'excerpt', 'body', 'description', 'content', 'preview']) ?? '';

  return {
    title,
    snippet: snippet.slice(0, 200),
    url: pickString(first, ['url', 'permalink', 'link', 'webUrl', 'web_url', 'html_url']),
    author: pickString(first, ['author', 'user', 'from', 'sender', 'creator', 'created_by']),
    timestamp: pickString(first, ['timestamp', 'ts_iso', 'ts', 'date', 'created_at', 'updated_at', 'lastModifiedDateTime']),
  };
}

function firstResultObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }

  const record = asRecord(value);
  if (!record) return null;

  for (const key of ['messages', 'results', 'items', 'emails', 'events', 'pages', 'issues', 'documents', 'data', 'value']) {
    const nested = record[key];
    if (Array.isArray(nested) && nested.length > 0) {
      return asRecord(nested[0]);
    }
  }

  return record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}
