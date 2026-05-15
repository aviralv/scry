# scry — Design Spec

**Date**: 2026-05-15
**Status**: Approved
**Author**: Avi + Claude

---

## Overview

scry is a CLI tool that orchestrates search across multiple MCP servers, synthesizes results with an LLM, and presents a cited answer. It is not a search engine — it's a search orchestrator that leverages each tool's native search API via MCP protocol.

**CLI-first.** Web UI (`scry serve`) comes later, only after validating the core orchestration works.

---

## Architecture

```
scry "what did we decide about ECA pricing?"
  │
  ├─ 1. Parse query
  ├─ 2. Consult registry (people, projects → source routing)
  ├─ 3. Decompose into source-specific searches
  ├─ 4. Spawn MCP server connections (from config)
  ├─ 5. Fan out parallel search calls via MCP protocol
  ├─ 6. Collect snippets from all sources
  ├─ 7. Send snippets + query to LLM for synthesis
  └─ 8. Print synthesized answer with inline citations
```

### Stack

- **Language**: TypeScript (Node.js)
- **MCP Client**: `@modelcontextprotocol/sdk` (client mode, stdio transport)
- **LLM**: BYOK — configurable base URL + auth token + model (supports Anthropic-compatible and OpenAI-compatible endpoints, including proxy servers)
- **CLI**: Commander.js or similar
- **Config**: YAML (parsed with `yaml` package)

### Prior Art

The lynx project (`Playground/lynx/lynx-app/mcp_client.py`) has a battle-tested MCP client manager in Python that handles stdio + HTTP transports, tool discovery, and connection lifecycle. The pattern ports to TypeScript.

---

## Configuration

### `scry.config.yaml` — Connections

```yaml
llm:
  base_url: "http://localhost:6655/anthropic/"
  auth_token: "${ANTHROPIC_AUTH_TOKEN}"
  model: "claude-haiku-latest"

mcp_servers:
  slack:
    command: "slack-mcp"
    env:
      SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}"
  microsoft-365:
    command: "microsoft-365-mcp"
  confluence-jira:
    command: "confluence-jira-mcp"
    env:
      ATLASSIAN_URL: "${ATLASSIAN_URL}"
      ATLASSIAN_EMAIL: "${ATLASSIAN_EMAIL}"
      ATLASSIAN_API_TOKEN: "${ATLASSIAN_API_TOKEN}"

search_tools:
  slack:
    - tool: "slack_search"
      params: { format: "json" }
  microsoft-365:
    - tool: "outlook_list_messages"
      params: { format: "json" }
    - tool: "teams_search_messages"
      params: { format: "json" }
  confluence-jira:
    - tool: "confluence_search"
      params: { format: "json" }
    - tool: "jira_search"
      params: { format: "json" }
```

**Bootstrap**: Initially can be generated from Claude Code's MCP config. Later: editable from web UI.

**Environment variable resolution**: `${VAR_NAME}` syntax in YAML resolves from process env at startup.

### `registry.yaml` — Context (People + Projects)

```yaml
people:
  marcus-karlbowski:
    name: Marcus Karlbowski
    role: Engineering Manager
    teams: [Nova, Catalog & Recommendation, LeanIX]
    identifiers:
      slack_username: marcus.karlbowski
      email: marcus.karlbowski@sap.com
    projects: [eca, dq-2.0]

  dimitri-natusch:
    name: Dimitri Natusch
    role: Engineer
    teams: [Nova, Catalog & Recommendation, LeanIX]
    identifiers:
      slack_username: dimitri.natusch
      email: dimitri.natusch@sap.com
    projects: [eca]

projects:
  eca:
    name: Enterprise Content Agent
    aliases: [UDA, Unstructured Data Agent]
    routing:
      slack_channels: [team-nova-internal]
      confluence_cql: "space.key = NOVA AND label = eca"
      jira_project: ECA
    people: [marcus-karlbowski, dimitri-natusch, bawa, aimad-jaouhar]

  dq-2.0:
    name: Data Quality 2.0
    routing:
      slack_channels: [team-nova-internal, dq-eng]
      confluence_cql: "space.key = NOVA AND label = dq"
      jira_project: DQ
```

**Purpose**: Enables intelligent query routing. When scry detects "ECA" in a query, it narrows Slack search to `in:#team-nova-internal`, Confluence to the NOVA space with eca label, Jira to the ECA project.

**`teams` is an array** — models the org hierarchy (team → tribe → company).

---

## Core Components

### 1. MCP Pool (Connection Manager)

Spawns and manages MCP server subprocesses via stdio transport.

```typescript
class McpPool {
  private connections: Map<string, McpClient>;

  async connect(config: ScryConfig): Promise<void>;
  async callTool(server: string, tool: string, args: Record<string, any>): Promise<any>;
  async shutdown(): Promise<void>;
}
```

**Lifecycle (CLI mode):**
- `scry "query"` → spawn servers → execute → shutdown
- Cold start ~2-3s (accepted for v1)

**Lifecycle (`scry serve` mode, future):**
- Servers stay alive between requests
- Cold start only on first query

### 2. Registry Loader

Parses `registry.yaml`, provides lookup methods.

```typescript
class Registry {
  people: Map<string, Person>;
  projects: Map<string, Project>;

  findPerson(name: string): Person | null;   // fuzzy match against names
  findProject(query: string): Project | null; // match against name + aliases
  getRouting(project: Project): RoutingConfig;
}
```

### 3. Entity Detector

Simple string matching against registry entries. No NLP, no embeddings — just token matching against known names, aliases, and project identifiers.

```typescript
function detectEntities(query: string, registry: Registry): DetectedEntities {
  // Returns: { people: Person[], projects: Project[] }
  // Matches query tokens against registry names/aliases (case-insensitive)
}
```

### 4. Search Planner

Builds source-specific queries using detected entities + routing config.

```typescript
function buildSearchPlan(
  query: string,
  entities: DetectedEntities,
  config: ScryConfig
): SearchAction[] {
  // For each configured search tool:
  //   - If entities detected → use routing info to narrow the query
  //   - If no entities → broad keyword search
  // Returns list of { server, tool, params } to execute
}
```

**Query construction per source:**

| Source | How routing narrows the query |
|--------|-------------------------------|
| Slack | Appends `in:#channel` from project routing |
| Confluence | Uses project's CQL template with query text added |
| Jira | Scopes to project key + text search |
| Email | Uses person's email in `from:` filter |
| Teams | Keyword search (no routing narrowing in v1) |

### 5. Result Normalizer

Maps each source's JSON response to a common format.

```typescript
interface SearchResult {
  source: "slack" | "confluence" | "jira" | "email" | "teams";
  title: string;
  snippet: string;
  author: string | null;
  timestamp: string;
  url: string | null;
  metadata: Record<string, string>;
}

function normalizeResults(
  rawResults: Map<string, any>,
  config: ScryConfig
): SearchResult[];
```

Each source needs a normalizer function that extracts the common fields from its JSON response shape.

### 6. Synthesizer

Sends normalized results + original query to the LLM. Returns a cited answer.

```typescript
async function synthesize(
  query: string,
  results: SearchResult[],
  llmConfig: LlmConfig
): Promise<SynthesisResult> {
  // Constructs prompt with numbered results
  // Calls LLM API (Anthropic or OpenAI compatible)
  // Returns { answer: string, citations: Citation[] }
}
```

**Synthesis prompt template:**

```
You are a search synthesis engine. Given a user's question and search results 
from multiple sources, provide a concise answer with inline citations.

Rules:
- Cite sources as [1], [2], etc.
- If results are insufficient to answer, say so explicitly
- Prioritize recent results over old ones
- Note disagreements between sources
- Keep answer under 200 words unless the question demands more

Question: {query}

Results:
[1] {source} — {title} — {author} — {timestamp}
    {snippet}

[2] ...
```

---

## CLI Interface

### Commands

```bash
# Primary: search
scry "what did we decide about ECA pricing?"
scry "Marcus updates this week"
scry "where did we discuss the API change?"

# Utilities
scry config show          # Print current config
scry registry show        # Print registry (people + projects)

# Future
scry config init          # Generate config from Claude Code settings (not in v1)
scry serve                # Start web UI (phase 2)
scry serve --port 3000
```

### Output Format (Terminal)

```
Based on discussions across Slack and Confluence, the ECA pricing
model was aligned on in the May 5 planning session [1]. Marcus 
proposed per-document pricing [1], Dimitri raised concerns about 
metering complexity [3]. The team aligned on a tiered model 
(proposed, not yet decided) [2].

Sources:
[1] Slack #team-nova-internal, May 5 — Marcus K.
    https://leanix.slack.com/archives/C.../p...
[2] Confluence: "ECA Pricing Strategy"
    https://leanix.atlassian.net/wiki/spaces/NOVA/pages/...
[3] Slack #team-nova-internal, May 6 — Dimitri N.
    https://leanix.slack.com/archives/C.../p...
```

---

## File Structure

```
scry/
├── src/
│   ├── cli.ts                 ← CLI entry point (Commander.js)
│   ├── core/
│   │   ├── mcp-pool.ts       ← MCP client connection manager
│   │   ├── registry.ts       ← Registry loader + lookup
│   │   ├── detector.ts       ← Entity detection (string matching)
│   │   ├── planner.ts        ← Search plan construction
│   │   ├── normalizer.ts     ← Per-source result normalization
│   │   └── synthesizer.ts    ← LLM synthesis with citations
│   ├── config/
│   │   ├── loader.ts         ← YAML config parsing + env resolution
│   │   └── types.ts          ← TypeScript types for config/registry
│   └── serve.ts              ← Web server entry (future)
├── registry.yaml              ← Context registry (people + projects)
├── scry.config.yaml           ← MCP servers + LLM config
├── package.json
├── tsconfig.json
├── docs/specs/
│   └── 2026-05-15-scry-design.md  ← This file
└── session-notes/
```

---

## Risks (Acknowledged)

| Risk | Mitigation |
|------|-----------|
| Query decomposition quality | Start with simple keyword pass-through + routing. Iterate. |
| Snippet quality varies by source | Email previews often useless — may need selective full-fetch later |
| Cold start latency (~5-8s in CLI mode) | Accepted for v1. Daemon mode or `scry serve` solves later. |
| MCP server subprocess management | Proven pattern from lynx. Port carefully. |
| LLM synthesis hallucination | Strict prompt: "only cite what's in results, say 'insufficient' if unsure" |

---

## First Milestone (Validation Criteria)

Query across Slack + Confluence + email → synthesized answer with citations → **faster than manually searching each tool individually.**

Specifically:
- 3 sources searched in parallel
- Results synthesized with inline citations
- Total time < 10s (including cold start)
- Answer quality: surfaces results you'd miss searching one tool at a time

---

## What's NOT in v1

- Web UI (`scry serve`)
- Auto-enrichment of registry
- Embeddings or vector store
- Conversation/follow-up queries
- Caching or persistent index
- Team features (shared registry)
- `scry config init` (manual config for now)

---

## Connections to Other Ideas

- **AI knowledge maintenance** — scry's orchestration enables freshness verification
- **Epistemic layering** — results could carry trust levels (decided vs proposed)
- **Voice-native contribution** — voice queries as input to scry
- **Team knowledge layer** — scry is the infrastructure that would enable shared search
