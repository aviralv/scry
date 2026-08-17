# scry - 2026-08-17 - Provider, Connector, and Registry Upgrade

## What changed

### Connector contracts now match the local MCP tools
- Updated bundled defaults for the current ms365 and Atlassian intent tools: ms365 uses `find`, and Confluence/Jira uses `atlassian_search`.
- Auto-search can now build nested `payload` inputs for MCP tools that advertise payload-shaped schemas.
- Atlassian search receives a combined Confluence CQL/Jira JQL payload with registry routing hints when project metadata is available.

### Source cards handle the current connector result shapes
- ms365 `find_results.hits` now produce usable source cards.
- Combined Atlassian responses are scanned through nested `confluence.results` and `jira.issues` envelopes.
- Result-card extraction recognizes fields such as `body_preview`, `web_link`, `self`, `fields.summary`, and `created`.

### Provider quirks are explicit
- OpenAI-compatible providers no longer blindly append duplicate `/v1` suffixes.
- Gemini uses the OpenAI-compatible `/v1beta/openai` base path.
- LLM test calls and runtime provider calls now share the same endpoint rules for OpenAI, Gemini, and Ollama.

### UX polish
- The LLM settings form now switches base URL, model, auth placeholder, and detected environment reference by provider.
- Settings copy reflects the supported provider set: Anthropic, OpenAI, Gemini, and Ollama.
- Registry entry creation derives a slug key from the display name until the user manually edits the key.

## Validation

- Backend test suite passed: `npm test`.
- Server typecheck passed: `npm run build:server`.
- Web test suite passed: `cd web && npm test`.
- Web production build passed: `cd web && npm run build`.
- Playwright e2e passed: `npm run test:e2e`.
- A live MCP schema probe confirmed local command availability, but ms365 connection requires user auth via `ms365-intent-mcp auth` before live listing/search can succeed.

## Remaining product risks

- Atlassian query generation is conservative string construction; real workspace examples should drive future ranking/filter tuning.
- Registry population is easier at entry creation time, but there is still no bulk import or connector-assisted registry bootstrap.
