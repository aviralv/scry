# scry — 2026-08-16/17 — Revival + Settings Hub + Multi-Provider Engine

## What was done

### Recovery pass (main)
- npm audit fix: 11 → 0 vulnerabilities
- SDK updated 0.3.150 → 0.3.233, `as never` cast removed
- CLI version synced 0.2.0 → 0.3.0
- write-config-pair.ts committed, stale worktree deleted
- .scry.env gitignored

### Settings Hub (PR #32, merged)
- Unified `/settings` route with sub-nav: LLM | MCPs | Registry
- `GET /api/llm` endpoint, `provider` field in config schema
- LlmForm component with provider dropdown (Anthropic/OpenAI/Gemini/Ollama)
- Legacy routes redirect to settings

### Multi-Provider Engine (PR #32, merged)
- **Removed** `@anthropic-ai/claude-agent-sdk` entirely
- Provider abstraction: `AnthropicProvider` (streaming Messages API) + `OpenAIProvider` (covers Gemini/Ollama)
- MCP client via `@modelcontextprotocol/sdk` — direct stdio connections, tool listing, call routing
- Agentic loop: LLM → tool calls → parallel MCP execution → feed back → loop (max 10 turns)
- Provider-aware `llm-test.ts` (Anthropic, OpenAI, Gemini, Ollama endpoints)

### Issues closed
- #15: structured logger (stderr, SCRY_LOG_LEVEL)
- #16: stale SCRY_LLM_TOKEN cleanup via `removeDotEnvKeys()`
- #18: already fixed

### Bug fixes during testing
- Citation clicks open source URL in new tab
- parseSources handles em-dash + bare trailing URL formats
- parseToolResultForCard handles Slack `{messages: [{permalink}]}` format
- Source merger: tracker URLs inherited by parsed sources
- persistTurn gracefully handles closed DB

## Open issues for next session

### 1. Only first source card is clickable (URL merge by index is broken)
The tracker assigns arrival-order indices (1, 2, 3...) as tool results come back. `parseSources` assigns indices from the LLM's [1], [2], [3] enumeration. The merge matches by `card.index === trackerCard.index` — but these don't necessarily correspond to the same source. Card [1] works because it's often the first Slack result in both lists.

**Fix**: Don't match by index. Match by source name + URL pattern (tracker cards have URLs; find the best match for each parsed source by comparing source field and title keywords).

### 2. Model doesn't consistently search all MCPs
Without fanout mode, the model decides which tools to call. It heavily favors Slack and sometimes skips ms365/confluence-jira entirely. The system prompt says "call ALL configured search tools" only in fanout mode.

**Fix options**:
- Default fanout mode to true (always search all sources first turn)
- Make the system prompt more directive: "On your first turn, call at least one search tool per configured server"
- Add a `search_tools` mapping that tells the engine which specific tools are the "search" tools per server, and auto-call them before LLM synthesis

### 3. ms365 and confluence-jira card titles show "untitled" / "tool result"
`parseToolResultForCard` handles Slack's `{messages: [{permalink, channel_name}]}` format but not:
- ms365: different response structure (emails, events)
- confluence-jira: likely `{results: [{title, url, excerpt}]}` or similar

**Fix**: Test actual ms365 and confluence-jira tool results, add format handlers to `parseToolResultForCard`.

### 4. Sources: block not stripped from answer
`stripEnumeration` only works when `finalized` is true (set by `sources-finalized`). If `sources-finalized` fires but the parsed sources don't match what the LLM wrote (URL mismatch), the Sources: block may still show. Need to verify this path works end-to-end.

## Architecture notes
- The engine connects to MCP servers PER QUERY (no persistent connections). Each search spawns subprocesses, connects, lists tools, runs the loop, then disconnects. This adds ~2-3s latency per query but is simpler and avoids state management issues.
- The `openai` SDK dependency was added for multi-provider support.
- Test suite: 346 backend + 122 web = 468 passing.
