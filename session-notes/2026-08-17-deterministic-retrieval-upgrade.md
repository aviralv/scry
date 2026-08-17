# scry — 2026-08-17 — Deterministic Retrieval Upgrade

## What changed

### Engine retrieval is now deterministic by default
- `runQuery` now uses `config.search_tools` to auto-call configured MCP search tools before the first LLM synthesis turn.
- The auto-search path creates provider-valid synthetic tool-use/tool-result messages, so Anthropic/OpenAI-compatible providers receive a normal tool conversation instead of a text dump.
- Explicit `fanoutMode: false` still skips auto-search and leaves tool choice to the model.

### Registry data now shapes search inputs
- Matching people/projects in the registry enrich the generated search query with identifiers and routing terms.
- Matching project routing can populate recognized tool args such as Slack channels, Jira project key, and Confluence CQL when the MCP tool schema advertises compatible fields.

### Source handling cleanup carried forward
- Parsed LLM source entries inherit tracker URLs by source/title match instead of numeric index equality.
- MCP result cards handle common result envelopes (`messages`, `results`, `items`, `emails`, `events`, `pages`, `issues`, etc.).

### Consistency and cleanup
- `/api/search` now uses the same boot-resolved config path as the rest of the API surface.
- The web search input defaults to searching all configured sources first.
- The web search view now treats the engine's `done.finalAnswer` as authoritative, matching server persistence semantics.
- Removed stale `@anthropic-ai/claude-agent-sdk` dependency; the code uses `@anthropic-ai/sdk` directly.
- README CLI/search behavior updated to match the current command surface.

## Tests added

- Engine regression for default auto-search from `search_tools`.
- Engine regression for `fanoutMode: false` opt-out.
- Engine regression for registry-enriched search inputs.
- Engine regression for unavailable configured tools being skipped.
- UI regression for default all-source search.

## Remaining product risks

- Registry matching is intentionally conservative string matching, not a full planner.
- Search arg enrichment only writes fields that appear in the MCP tool schema or falls back to a query-like field when schema details are absent.
- Real connector fixtures for Slack/ms365/Confluence/Jira should still be collected to harden result-card normalization.
