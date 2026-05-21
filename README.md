# scry

Federated search orchestrator over MCP. Query Slack, Confluence, email, and more from a single CLI — get synthesized answers with source attribution.

## Quick Start

```bash
npm install -g scry
scry init
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

Any MCP server with search tools works — these three are bundled with optimized normalizers.

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
      normalizer: "slack"
  ms365:
    - tool: "outlook_list_messages"
      params: { format: "json" }
      normalizer: "email"

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

## How Normalizers Work

Each MCP server returns different JSON shapes. Scry uses **normalizers** to convert them into a common format:

- **Built-in**: `slack`, `confluence`, `email` — optimized for known response shapes
- **Generic fallback**: Best-effort extraction for unknown servers (results marked low-confidence)
- **Config-driven**: Set `normalizer: "slack"` in `search_tools` to assign a normalizer to any tool

## Requirements

- Node.js >= 20
- At least one MCP server installed and authenticated
- An Anthropic API key (for synthesis)
