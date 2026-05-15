# scry

Personal federated search orchestrator over MCP. Routes natural language queries to search APIs in parallel, synthesizes results with source attribution.

## What This Does

`scry` is a CLI tool that answers "where did we discuss X?" across all your fragmented tools — without re-indexing their content. It:

1. Takes a natural language query
2. Consults a context registry (people, projects, source mappings) for intelligent routing
3. Fans out parallel search calls to MCP servers (Slack, Confluence, email, Jira, etc.)
4. Synthesizes results across sources with attribution

## Why This Exists

Small teams fragment knowledge across 5-10 tools. Glean solves this for enterprises (500+ seats, expensive, months of setup). Nothing exists at personal/small-team scale.

MCP standardizes the connector layer — the ecosystem builds connectors to every SaaS tool. What's missing is the intelligence layer: knowing which sources to query, how to decompose the question, and how to synthesize across results.

## Architecture

```
┌─────────────────────────────────────────┐
│  Query Layer (natural language)          │
├─────────────────────────────────────────┤
│  Orchestrator: decompose → route →      │
│  parallel search → synthesize → cite    │
├─────────────────────────────────────────┤
│  Context Registry (people, projects,    │
│  channels, spaces — routing table)      │
├─────────────────────────────────────────┤
│  MCP search tools (native APIs)         │
├─────────────────────────────────────────┤
│  Slack  │ M365  │ Atlassian │ GitHub │...│
└─────────────────────────────────────────┘
```

**Key design decisions:**
- Search orchestration, not a search engine — uses each tool's native search API
- Context registry is a YAML file of people/projects/source mappings (not a vector store)
- Local-first, no cloud dependency
- User's own OAuth tokens via MCP servers

## First Milestone

Query across Slack + Confluence + email, get a synthesized answer with source attribution — faster than manually searching each tool individually.

## Status

Early development. Stack TBD.
