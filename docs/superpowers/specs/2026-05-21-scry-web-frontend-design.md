# scry web frontend (v1) — design spec

**Date:** 2026-05-21
**Status:** Draft, in review (Opus + GPT + Gemini)
**Builds on:** [scry CLI v0.1.3](../../../README.md), [lynx](../../../../lynx/README.md) (visual + UX reference)
**Out of scope:** publishing v1 to npm (decided separately)

---

## Goal

Add a localhost web GUI to `scry` so the four user surfaces — search, MCP server management, config editing, first-run onboarding — are all available in a browser. The CLI keeps working unchanged. Both surfaces call the same in-process engine.

## Non-goals (v1)

- Multi-user / multi-tenant
- Remote (non-localhost) deployment
- Auth, sessions, or accounts
- Mobile-responsive layout
- Persistent search history beyond the current tab
- Replacing the CLI

## What we're building (and why)

The CLI is correct for one-shot queries from a terminal, but four scry use cases push past it:

1. **Search ergonomics** — multi-source results with snippets benefit from a panel layout, not a stdout dump.
2. **MCP management** — adding/removing servers via YAML edits is high-friction; lynx's MCP modal proved the pattern works.
3. **Config editing** — `scry.config.yaml` plus `.scry.env` is brittle for non-Avi users.
4. **Onboarding** — `scry init` is a flat prompt sequence; a wizard is more legible.

The visual identity, the localhost-server pattern, and the MCP-CRUD interaction model are inherited from lynx (in spirit, not in code — see "Reuse from lynx" below). The implementation language is TypeScript end-to-end, matching scry's existing engine.

## Architecture

```
┌───────────────── scry binary (Node) ─────────────────┐
│                                                       │
│   CLI entry      `scry serve`                         │
│   ──────         ────────────                         │
│   src/cli.ts ─┬─> existing query/config-show actions  │
│               └─> NEW: boot Hono server               │
│                                                       │
│                   ┌───────────────────────────────┐   │
│                   │  src/server/  (Hono)          │   │
│                   │  ┌─────────────────────────┐  │   │
│                   │  │ /api/search   (SSE)     │  │   │
│                   │  │ /api/mcps                │  │   │
│                   │  │ /api/config              │  │   │
│                   │  │ /api/onboarding          │  │   │
│                   │  │ static: dist/web/*       │  │   │
│                   │  └─────────────────────────┘  │   │
│                   │           │  in-process       │   │
│                   │           ▼  function calls   │   │
│                   │  ┌─────────────────────────┐  │   │
│                   │  │ src/core/  (existing)   │  │   │
│                   │  │ planner, McpPool,       │  │   │
│                   │  │ normalizer, synthesizer │  │   │
│                   │  └─────────────────────────┘  │   │
│                   └───────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP + SSE
                              │ (localhost:6678)
                              ▼
                    ┌───────────────────────┐
                    │  React + Vite app     │
                    │  served from          │
                    │  dist/web/index.html  │
                    └───────────────────────┘
```

### Single-process design

The Hono server runs **in the same Node process** as scry's engine. Routes call `buildSearchPlan`, `McpPool`, `synthesize` directly — no IPC, no subprocess, no HTTP loopback to the CLI. The existing `src/core/` modules are imported as-is.

Reasoning: scry's MCP work is already async. Long-running operations (a search fanout, an LLM synthesis) yield to the event loop between awaits. Adding a worker thread or process boundary buys no concurrency benefit at single-user scale and complicates state sharing (the `McpPool` instance, in particular, should be a singleton).

### Streaming via SSE

`POST /api/search` opens an SSE stream. Server emits typed events as they happen:

```ts
type SearchEvent =
  | { type: 'detected'; entities: { projects: string[]; people: string[] } }
  | { type: 'plan'; sources: { server: string; tool: string }[] }
  | { type: 'source-result'; server: string; results: SearchResult[] }
  | { type: 'source-error'; server: string; message: string }
  | { type: 'synthesizing' }
  | { type: 'answer-chunk'; text: string }
  | { type: 'citation'; citation: Citation }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

SSE over WebSocket because scry's data flow is one-way (server → client). The client doesn't need to send anything mid-search. Server uses Hono's `streamSSE` helper.

### Backend framework: Hono

Hono over Express because: built-in TypeScript types, smaller bundle, native SSE helper, modern middleware. No part of scry needs Express's ecosystem. ~25 LOC of route definitions per surface.

## Repo layout

Additions only — existing files stay where they are:

```
scry/
├── src/
│   ├── cli.ts                     # add `scry serve` subcommand
│   ├── server/                    # NEW
│   │   ├── index.ts               # createServer(config): Hono app
│   │   ├── boot.ts                # listen + open browser
│   │   ├── routes/
│   │   │   ├── search.ts          # POST /api/search → SSE
│   │   │   ├── mcps.ts            # GET/POST/PATCH/DELETE /api/mcps
│   │   │   ├── config.ts          # GET/PUT /api/config
│   │   │   └── onboarding.ts      # GET state, POST step
│   │   ├── stream.ts              # SSE typed-event helpers
│   │   └── types.ts               # event types shared with web/
│   └── core/                      # existing — no change
├── web/                           # NEW (Vite + React + TS)
│   ├── package.json               # local deps for web build only
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                # router shell
│       ├── theme/
│       │   ├── tokens.css         # CSS custom properties (the rebrand surface)
│       │   └── tailwind.config.ts # maps tokens → utility classes
│       ├── routes/
│       │   ├── Search.tsx
│       │   ├── McpManager.tsx
│       │   ├── Settings.tsx
│       │   └── Onboarding.tsx
│       ├── components/            # buttons, inputs, modals
│       └── lib/
│           ├── api.ts             # fetch wrappers, typed
│           ├── sse.ts             # SSE client + typed events
│           └── types.ts           # imports from src/server/types.ts
├── dist/web/                      # Vite output, included in tarball
└── package.json                   # adds `hono`, `open`; web deps in web/package.json
```

`web/` has its own `package.json` so React/Vite/Tailwind devDependencies don't bloat scry's runtime closure. Top-level scripts:

- `npm run build:web` → `cd web && npm run build` → outputs to `../dist/web`
- `npm run build` → `tsc && npm run build:web`
- `npm run dev:web` → Vite dev server at :5173, proxies `/api/*` to :6678

## v1 feature surfaces

### Search (`/`)

**Layout:** query input at top; result panel below split into a results column (cards grouped by source) and a synthesis column (streaming answer + citations).

**Behavior:**
- Submit → POST `/api/search` with `{ query, timeout? }`.
- Server emits SSE events; client renders progressively.
- Per-source results appear as cards; synthesis appears as a streaming panel; citations link back to result cards.
- A failed source shows a strikethrough card with error text — does not block other sources.

**Out of v1:** saved searches, history, favorites, advanced query syntax UI.

### MCP manager (`/mcps`)

**Layout:** table of configured MCP servers with name, command (or URL for HTTP), status (connected / not configured / error), tool count. "Add MCP" button opens a modal.

**Behavior:**
- `GET /api/mcps` → list with live status from `McpPool`
- `POST /api/mcps` → add a new server (name, command/url, env vars, args)
- `PATCH /api/mcps/:name` → edit
- `DELETE /api/mcps/:name` → remove
- `POST /api/mcps/:name/reconnect` → kick connection
- Writes go to `scry.config.yaml`; pool is rebuilt on change.

**Out of v1:** auto-discovery from PATH, MCP marketplace integration, per-tool overrides via UI.

### Settings (`/settings`)

**Layout:** sectioned form — LLM (base_url, model, auth_token reference), Registry (people, projects), Search-tool params per server.

**Behavior:**
- `GET /api/config` → redacted view (auth_token shown as `${ENV_VAR}` placeholder, never the value)
- `PUT /api/config` → write back. YAML round-trip preserves comments/order via `yaml`'s document API.
- Auth tokens never sent to client. Editing the LLM section lets the user choose either an env-var reference or to write a value to `~/.config/scry/.scry.env` (server appends with permission `0600`).

**Out of v1:** YAML diff preview before save, multi-environment config switching.

### Onboarding (`/onboarding`)

**Layout:** four-step wizard. Replaces `scry init` for first-time users.

1. **Welcome + check.** Server probes for existing config; if found, wizard offers "skip" or "edit existing".
2. **LLM connection.** Pick provider preset (Anthropic / Hyperspace proxy / custom OpenAI-compatible), enter base URL, token. Validate by hitting `/v1/models` or equivalent.
3. **MCP servers.** List bundled servers detected on PATH (slack-mcp, ms365-intent-mcp, confluence-jira-mcp). Toggle on/off; for each, capture required env vars.
4. **Done.** Write `scry.config.yaml` to `$XDG_CONFIG_HOME/scry/` (default `~/.config/scry/`); write `.scry.env` for any captured secrets. Show "you're set" + link to search.

**State:**
- `GET /api/onboarding` → returns `{ configExists: bool, lastCompletedStep: 0..4 }`
- `POST /api/onboarding/:step` → saves partial state in memory until step 4 commits to disk.
- Resumable across page reloads via server-held in-memory state (lost on server restart — fine for one-time flow).

**Server boot logic:** if `scry serve` runs and no config is found at any resolution step, the server starts but redirects all routes except `/onboarding` and `/api/onboarding` to `/onboarding`. After step 4 commits, normal routing resumes.

**Out of v1:** importing config from another machine, OAuth-style MCP auth flows.

## Reuse from lynx

What's borrowed (in pattern, not in code, since lynx is Python + vanilla JS):

| From lynx | What we take | Implementation |
|---|---|---|
| `styles.css` ~25 CSS variables | Token approach | `web/src/theme/tokens.css` defines the same set; values are scry's own |
| `index.html` layout shell | Sidebar + main split | React layout component; structurally similar |
| MCP add/remove modal | Form UX (name, type, URL/command, headers/env) | `McpManager.tsx` modal — different code, same UX |
| `setup.sh` flow | Onboarding wizard structure | Multi-step React wizard backed by `/api/onboarding` |
| `mcp_config.json` schema | Server-add JSON shape | scry already has equivalent in `scry.config.yaml`; UI form maps to it |

What's NOT borrowed: any Python code, any vanilla-JS code, the LeanIX-specific UI panels, the FastAPI routes (different framework).

## Visual identity (rebrand)

Lynx's identity: warm amber `#c4953a` accent on near-black `#0e0e10` background, serif headings (Literata).

Scry's v1 identity (placeholder, lockable later):
- Accent: cool/teal — `#3aa39c` direction (to differentiate from lynx)
- Background: same dark base or slightly cooler `#0c0e10`
- Mono: JetBrains Mono (same as lynx — universally good)
- Headings: Inter (instead of Literata) — neutral, no editorial connotation
- Light/dark mode toggle — same `[data-theme="light"]` pattern as lynx

These are starting values. The rebrand surface is `web/src/theme/tokens.css` — ~25 vars. Changing the visual identity later is a single file edit.

## Dev workflow

- `npm run dev` → tsc watch on server, Vite dev server on :5173 with `/api/*` proxy → :6678
- `npm run build` → `tsc` (server) + `vite build` (frontend → `dist/web/`)
- Production install: `npm i -g @aviralv/scry` then `scry serve` → boots single-process server, opens browser to `http://localhost:6678`

## Testing

| Layer | Tooling | Coverage target |
|---|---|---|
| Server routes | vitest (existing), supertest-style requests against the Hono app | Each route's happy path + at least one error path |
| Engine (existing) | vitest | Already covered |
| Frontend components | vitest + Testing Library | Search results render, MCP modal opens, onboarding step navigation |
| End-to-end | Playwright, smoke tests only | `scry serve` boots, query returns results, MCP add round-trips |

E2E tests run against a real localhost server with a stubbed MCP fixture (existing test fixtures pattern).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| React + Vite drag scry's install size up | All UI deps in `web/package.json` (devDependencies); only built static assets ship |
| SSE stream stalls on long synthesis | Server emits keep-alive comments every 15s; client reconnects on `error` event |
| Config edits via UI corrupt YAML formatting | Use `yaml` library's document API (preserves comments/order); show server-side diff on write fail |
| In-process model means one rogue MCP can hang the server | Per-tool timeout already exists in `McpPool`; surface as a UI banner if a server stays in `connecting` >10s |
| Onboarding state lost on server restart mid-flow | Persist a tiny `~/.config/scry/.onboarding.json` between steps 2-3; clear on completion |

## Acceptance criteria

- `scry serve` boots a localhost server, opens browser to the search page (or onboarding if no config).
- A search from the UI returns the same results as `scry "<query>"` from the CLI, with synthesis streaming.
- Adding/editing/deleting an MCP via the UI updates `scry.config.yaml` and is reflected on the next search.
- Editing LLM connection or registry via Settings persists to `scry.config.yaml`; secrets persist to `.scry.env`.
- A user with no config file can complete onboarding and run a search without ever touching the CLI.
- `scry "<query>"` (CLI) continues to work unchanged.
- Visual identity is distinguishable from lynx — color scheme + heading font are different — and changing it requires touching only `web/src/theme/tokens.css`.

## Decision log

- **Build, not fork** — research showed no clean fork target; closest (`sugyan/claude-code-webui`) wraps Claude Code CLI and would cost more to gut than to greenfield.
- **TS end-to-end** — keeps scry's engine without porting; rules out Python lynx-fork.
- **React + Vite** — the four UI surfaces are more state than vanilla can carry cleanly. Tailwind layered on CSS variables for theming.
- **Hono over Express** — built-in types, native SSE helper, modern.
- **SSE over WebSocket** — search data flow is one-way.
- **In-process** — single-user tool, no concurrency win from process boundary, simplifies state sharing of `McpPool`.
- **Single repo, single npm package** — `web/` ships built assets; no monorepo overhead. Future split (`packages/core` etc.) is an option later if a second consumer emerges.
- **CLI stays** — both entry points use the same engine; no deprecation in v1.

## Open questions for review

These are intentionally surfaced for the reviewers below to push back on:

1. Is the **in-process** assumption sound for a search that fanouts to 5+ MCP servers? Worker thread might be worth it if synthesis blocks the event loop.
2. Is **single repo / single package** going to bite us when the published tarball gets too big? Monorepo at v2 is fine, but maybe the split should happen now to avoid a painful migration.
3. **Onboarding state persistence** — is in-memory plus a sidecar JSON file the right minimum, or should it just be all-or-nothing (write config on step 4 only, no resume)?
4. **Config editor** — round-tripping YAML while preserving comments is non-trivial. Is the v1 scope here too ambitious vs. a simpler "edit and overwrite" approach with a warning?
5. **Auth tokens in config UI** — the current design says "never send the value to the client, only the env-var reference." Should the UI even let the user enter a literal token value (writing to `.scry.env`), or always require them to set the env var themselves?
