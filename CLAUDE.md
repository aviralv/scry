# Scry — Project Context

## What This Is

Personal federated search orchestrator over MCP. CLI tool that routes natural language queries to search APIs (Slack, Confluence, email, Jira) in parallel via MCP servers, then synthesizes results with source attribution.

## Core Concept

Search orchestration, not a search engine. Each source already has good search — the value is:
1. Knowing which sources to query (context registry)
2. Decomposing natural language into source-specific queries
3. Synthesizing across results with attribution

## Architecture

- **Context registry**: YAML file mapping people → identifiers, projects → sources
- **Orchestrator**: reads registry, decomposes query, fans out parallel MCP search calls
- **Synthesizer**: LLM combines snippet-level results with source citation
- **Interface**: CLI (query in → synthesized answer out)

## Key Files

- `registry.yaml` — People, projects, source mappings
- `README.md` — Project overview

## Design Principles

1. No behavior change required — user keeps existing tools
2. User's own authorization via MCP OAuth
3. Local-first — registry is a file, no cloud dependency
4. MCP-native — leverages ecosystem connectors
5. Orchestration over indexing — value is in routing and synthesis

## Risks (Acknowledged)

- Query decomposition quality (start simple, iterate)
- Snippet quality varies by source
- Latency of parallel calls (~2-3s)

## Session Notes

Session notes live in `session-notes/` (private repo).

## Related

- Idea doc: `the-product-kitchen/Work/Ideas/2026-05-15-personal-federated-search-over-mcp.md`
- Existing MCP servers (starting connectors): slack-mcp, microsoft-365-mcp, confluence-jira-mcp
- Product-kitchen's `/morning` and `calendar-confluence` agent are early prototypes of this orchestration pattern
