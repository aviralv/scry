# scry

Federated search orchestrator over MCP. Query Slack, Confluence, email, and more from a single CLI — get synthesized answers with source attribution.

[![CI](https://github.com/aviralv/scry/actions/workflows/ci.yml/badge.svg)](https://github.com/aviralv/scry/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aviralv/scry.svg)](https://www.npmjs.com/package/@aviralv/scry)

## Quick Start

```bash
npm install -g @aviralv/scry
scry serve            # opens the web UI; walks a 3-step setup wizard
```

Or use the CLI directly:

```bash
scry init             # one-time setup
scry "what did we decide about pricing?"
```

## How It Works

```
query → discover sources → parallel search → normalize → synthesize → cited answer
```

1. **Discover**: Detects MCP servers from your Claude config or PATH
2. **Route**: Uses a context registry (people, projects, channels) to target the right sources
3. **Search**: Fans out parallel queries with per-source timeouts
4. **Synthesize**: LLM combines results with source citations

## Supported MCP Servers

| Name | Command | Install |
|------|---------|---------|
| Slack | `slack-mcp` | `uv tool install git+https://github.com/aviralv/slack-mcp` |
| Microsoft 365 | `ms365-intent-mcp` | `uv tool install git+https://github.com/aviralv/ms365-intent-mcp` |
| Confluence & Jira | `confluence-jira-mcp` | `uv tool install git+https://github.com/aviralv/confluence-jira-mcp` |

Any MCP server with search tools works — these three are bundled with metadata that lets `scry init` add them in one step.

## Configuration

### Where scry looks for config

Scry resolves the config path in this order, taking the first hit:

1. `-c <path>` flag passed on the command line
2. `SCRY_CONFIG` environment variable
3. `./scry.config.yaml` in the current working directory
4. `$XDG_CONFIG_HOME/scry/scry.config.yaml` (defaults to `~/.config/scry/scry.config.yaml`)

For a global install (`npm i -g @aviralv/scry`), the recommended setup is:

```bash
scry init -d ~/.config/scry
```

This puts the config at the XDG location so `scry "<query>"` works from any directory. A `.scry.env` file placed alongside the config (e.g. `~/.config/scry/.scry.env`) is loaded automatically and supplies secrets without exposing them in `scry.config.yaml`.

`scry init` generates a `scry.config.yaml`:

```yaml
llm:
  base_url: "https://api.anthropic.com"
  auth_token: "${ANTHROPIC_API_KEY}"
  model: "claude-haiku-4-5-20251001"

mcp_servers:
  slack:
    command: "slack-mcp"
  ms365:
    command: "ms365-intent-mcp"

search_tools:
  slack:
    - tool: "slack_search"
      params: { format: "json" }
  ms365:
    - tool: "outlook_list_messages"
      params: { format: "json" }

registry:  # optional — enables context-aware routing
  projects:
    my-project:
      name: My Project
      routing:
        slack_channels: [team-channel]
        jira_project: PROJ
```

## CLI Options

```
scry [query]              Search and synthesize
scry init                 Interactive setup wizard
scry config show          Show current configuration

Options:
  -c, --config <path>     Config file (default: see resolution chain in Configuration above)
  -t, --timeout <ms>      Per-source timeout (default: 15000)
  --no-synthesize         Show raw results without LLM synthesis
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SCRY_CONFIG` | Custom config file path |
| `ANTHROPIC_API_KEY` | LLM API key (used via `${...}` in config) |

## Requirements

- Node.js >= 20
- At least one MCP server installed and authenticated
- An Anthropic API key (for synthesis)

## Development

```bash
git clone https://github.com/aviralv/scry.git
cd scry
npm install
cd web && npm install && cd ..

npm run build               # build server + web
npm test                    # backend unit tests (vitest)
cd web && npm test          # web unit tests (vitest + RTL)
npm run test:e2e            # Playwright E2E (boots the server, isolated XDG dir)

# Optional
npm run eval:synthesis      # synthesis-quality eval (network; needs ANTHROPIC_API_KEY)
npm run publish:dry-run     # see what would publish to npm
```

CI runs unit tests, web tests, and E2E on every push and PR; see
[.github/workflows/ci.yml](.github/workflows/ci.yml).
