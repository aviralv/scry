# scry web frontend (v1) — design spec

**Date:** 2026-05-21 (revised 2026-05-22 after Opus + GPT + Gemini review)
**Status:** Approved, pending user sign-off before plan
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

**Cancellation.** Each search route handler creates an `AbortController`. Its signal is threaded through `buildSearchPlan` / `McpPool.callTool` / `synthesize` (existing engine code is updated to accept an optional `signal`). When the SSE client disconnects (`req.raw.signal` aborts in Hono), the route aborts its controller — in-flight MCP calls and the LLM streaming request both terminate. No orphaned awaits.

### Security (localhost hardening)

Even though scry binds to `127.0.0.1` only, a malicious page in any browser tab can issue cross-origin requests to `http://localhost:6678`. Mitigations applied in middleware:

- **Origin allowlist.** Reject any request whose `Origin` header is not `http://localhost:6678`, `http://127.0.0.1:6678`, or `http://[::1]:6678`. Same-origin browser fetches set this; cross-site forms do not. No CORS headers are emitted.
- **Per-boot CSRF token.** A random 32-byte token is generated on server boot, served in the SPA bootstrap (`/api/csrf` or via a `<meta>` tag in `index.html`), and required on all mutating routes (`POST`/`PUT`/`PATCH`/`DELETE`) via a `X-Scry-Csrf` header. GET routes are read-only.
- **CSP on the SPA.** `Content-Security-Policy: default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`. Tailwind's runtime needs inline styles in dev; production build inlines a hash.
- **No third-party assets.** All fonts, scripts, and styles are bundled or served from `/`. No CDN imports.

### Backend framework: Hono

Hono over Express because: built-in TypeScript types, smaller bundle, native SSE helper, modern middleware. No part of scry needs Express's ecosystem. ~25 LOC of route definitions per surface.

## Repo layout

Additions only — existing files stay where they are:

```
scry/
├── src/
│   ├── cli.ts                     # add `scry serve` subcommand
│   ├── shared/                    # NEW — types referenced by both server and web
│   │   └── types.ts               # SearchEvent, McpStatus, ConfigShape, OnboardingState
│   ├── server/                    # NEW
│   │   ├── index.ts               # createServer(config): Hono app
│   │   ├── boot.ts                # listen + open browser
│   │   ├── middleware/
│   │   │   ├── origin.ts          # Origin allowlist
│   │   │   └── csrf.ts            # per-boot CSRF token check
│   │   ├── routes/
│   │   │   ├── search.ts          # POST /api/search → SSE
│   │   │   ├── mcps.ts            # GET/POST/PATCH/DELETE /api/mcps
│   │   │   ├── config.ts          # GET/PUT /api/config
│   │   │   └── onboarding.ts      # GET state, POST step
│   │   └── stream.ts              # SSE typed-event helpers
│   └── core/                      # existing — no change
├── web/                           # NEW (Vite + React + TS)
│   ├── package.json               # local deps for web build only
│   ├── vite.config.ts
│   ├── tsconfig.json              # paths: '@shared/*' → '../src/shared/*'
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
│           └── csrf.ts            # reads token from meta tag, attaches header
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
- `POST /api/mcps` → add a new server (name, command/url, env-var refs only, args)
- `PATCH /api/mcps/:name` → edit
- `DELETE /api/mcps/:name` → remove
- `POST /api/mcps/:name/reconnect` → kick connection
- Writes go to `scry.config.yaml` via the atomic-write procedure (see Settings).
- **Pool rebuild is atomic.** On any change, build a `nextPool` against the new config and connect/health-check it. Only after the new pool is ready does a single mutex-guarded swap replace the live pool reference; the old pool is then drained gracefully. In-flight searches against the old pool finish on it; new searches use the new pool. No torn state, no rejected connections during the swap.

**Out of v1:** auto-discovery from PATH, MCP marketplace integration, per-tool overrides via UI.

### Settings (`/settings`)

**Layout:** sectioned form — LLM (base_url, model, auth_token reference), Registry (people, projects), Search-tool params per server.

**Behavior:**
- `GET /api/config` → redacted view. `auth_token` values that are `${VAR}` references are returned as-is. Any literal value found in YAML is replaced with `***` and a flag indicating "value present but redacted." The actual literal is never sent to the client.
- `PUT /api/config` → write back via **edit-and-overwrite + auto-backup**. Comment preservation is explicitly out of v1: the form edits known top-level sections (`llm`, `mcp_servers`, `search_tools`, `registry`), the server merges those into the parsed object, schema-validates, then serializes via `yaml.stringify` and writes atomically (see "Atomic config writes" below). Comments and key order in the file may be lost on save; the UI shows a "comments will be reformatted" warning above Save. The previous file is copied to `scry.config.yaml.bak` before each write.
- **No literal token entry from the UI.** The auth-token field accepts only `${VAR_NAME}` references. If the user wants to set a token value, the UI shows copyable shell snippets (`echo "VAR=..." >> ~/.config/scry/.scry.env` and `chmod 600 ~/.config/scry/.scry.env`). The server never writes secret values to disk based on browser input. This shrinks the attack surface and avoids the question of secrets transiting loopback.

**Atomic config writes** (used by Settings, MCP manager, and Onboarding step 4):
1. Read current file; copy to `<path>.bak` (overwriting any existing backup).
2. Validate the new content against the config schema.
3. Write to `<path>.tmp`, `fsync`, then `rename` to `<path>` (atomic on POSIX).
4. On any failure, leave `.bak` untouched and surface a structured error to the client. Never partially overwrite the live file.

**Out of v1:** YAML diff preview before save, multi-environment config switching, comment-preserving round-trip, literal token entry.

### Onboarding (`/onboarding`)

**Layout:** four-step wizard. Replaces `scry init` for first-time users.

1. **Welcome + check.** Server reports whether config exists; if it does, wizard offers "skip" or "edit existing".
2. **LLM connection.** Pick provider preset (Anthropic / Hyperspace proxy / custom OpenAI-compatible), enter base URL, point to an env-var name for the auth token (with copyable shell snippet for setting it). Validate by hitting `/v1/models` or equivalent. **No literal token captured here** — same rule as Settings.
3. **MCP servers.** List bundled servers detected on PATH (slack-mcp, ms365-intent-mcp, confluence-jira-mcp). Toggle on/off; for each, capture required env-var names (not values).
4. **Done.** Atomically write `scry.config.yaml` to `$XDG_CONFIG_HOME/scry/` (default `~/.config/scry/`). Show "you're set" + the shell snippet to populate `.scry.env`, plus a link to search.

**State (all-or-nothing, no resume):**
- `GET /api/onboarding` returns `{ configExists: boolean }`. Wizard state lives in client memory only.
- `POST /api/onboarding/commit` accepts the full wizard payload at step 4 and atomically writes the config (using the same atomic-write procedure as Settings). Steps 1–3 don't touch disk.
- If the user closes the tab mid-wizard, they restart on next visit. Two-minute flow; resumability isn't worth the failure modes (stale sidecar, partial config, schema drift).

**Onboarding gating (client-side, not server redirect):**
- The SPA always loads. Its first action is `GET /api/onboarding` — if `configExists === false`, the SPA routes the user to `/onboarding` and shows the wizard. All other client routes display "Setup required" with a link to onboarding.
- Server-side: every mutating non-onboarding API endpoint (`POST/PUT/PATCH/DELETE /api/search|mcps|config`) returns `409 Conflict` with `{ error: 'config-required' }` when no config is found at boot. The SPA catches that and routes to onboarding. No HTTP redirects (which break POSTs and asset fetches).

**Out of v1:** importing config from another machine, OAuth-style MCP auth flows, resumable wizard state.

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
| React + Vite drag scry's install size up | All UI deps in `web/package.json` (devDependencies); only built static assets ship. CI check on tarball size to catch regressions. |
| `.npmignore` / `files` leaks `web/src` or dev deps into the published tarball | Explicit `files` allowlist in `package.json`: `["dist", "README.md"]`. CI inspects `npm pack --dry-run` output. |
| SSE stream stalls on long synthesis | Server emits keep-alive comments every 15s; client treats `error` as recoverable and reconnects. |
| Client navigates away mid-search → orphaned MCP/LLM calls | `AbortController` per search, signal threaded through engine, aborted on `req.raw.signal` disconnect. |
| Cross-origin browser tab fires requests at `localhost:6678` | Origin allowlist + per-boot CSRF token on mutating routes (see Security). |
| Config edits via UI corrupt YAML formatting | Atomic write (tmp + fsync + rename) with `.bak` copy of previous file. Schema validation before write. Comments may be lost — UI warns. |
| MCP pool teardown races a new search | Atomic pool swap under mutex (build new pool → health-check → swap → drain old). |
| In-process model means one rogue MCP can hang the server | Per-tool timeout already exists in `McpPool`; UI shows a banner if a server stays in `connecting` >10s; `AbortSignal` lets the search route move on without that source. |

## Acceptance criteria

- `scry serve` boots a localhost server, opens browser to the search page (or onboarding if no config).
- A search from the UI returns the same results as `scry "<query>"` from the CLI, with synthesis streaming.
- Closing the browser tab mid-search aborts in-flight MCP and LLM calls within 1s (no orphan awaits).
- Adding/editing/deleting an MCP via the UI updates `scry.config.yaml` atomically (with `.bak`) and is reflected on the next search via an atomic pool swap.
- Editing LLM connection or registry via Settings persists to `scry.config.yaml` atomically. The UI never accepts literal token values; it only accepts `${VAR}` references and shows shell snippets for setting the env var.
- A user with no config file can complete onboarding and run a search without ever touching the CLI. The UI gates onboarding client-side; mutating APIs return `409 config-required` when no config exists, never HTTP redirects.
- Cross-origin requests to `localhost:6678` from another browser tab are rejected (Origin check). Mutating routes without a valid `X-Scry-Csrf` header are rejected.
- A corrupt write attempt leaves `scry.config.yaml` and `scry.config.yaml.bak` intact; the UI shows a structured error.
- `scry "<query>"` (CLI) continues to work unchanged.
- Visual identity is distinguishable from lynx — color scheme + heading font are different — and changing it requires touching only `web/src/theme/tokens.css`.
- `npm pack --dry-run` shows only `dist/` and `README.md` in the published tarball; no `web/src`, no `node_modules`, no source maps.

## Decision log

- **Build, not fork** — research showed no clean fork target; closest (`sugyan/claude-code-webui`) wraps Claude Code CLI and would cost more to gut than to greenfield.
- **TS end-to-end** — keeps scry's engine without porting; rules out Python lynx-fork.
- **React + Vite** — the four UI surfaces are more state than vanilla can carry cleanly. Tailwind layered on CSS variables for theming.
- **Hono over Express** — built-in types, native SSE helper, modern.
- **SSE over WebSocket** — search data flow is one-way.
- **In-process** — single-user tool, no concurrency win from process boundary, simplifies state sharing of `McpPool`. Synthesis uses streaming HTTP so it doesn't block the event loop.
- **Single repo, single npm package** — `web/` ships built assets; no monorepo overhead. Future split (`packages/core` etc.) is an option later if a second consumer emerges. The underlying concern (dev deps leaking into the tarball) is addressed via an explicit `files` allowlist + CI check, not workspaces.
- **CLI stays** — both entry points use the same engine; no deprecation in v1.
- **Shared types in `src/shared/`** — both server and web consume from the same source. `web/tsconfig.json` aliases `@shared/*` → `../src/shared/*`. Avoids a cross-workspace import path that would break when `web/` builds.
- **No literal token entry from the UI** — only env-var references. Onboarding and Settings show shell snippets for setting the env var. Server never writes secret values to disk based on browser input.
- **Edit-and-overwrite for YAML, not round-trip** — comment preservation is too complex for v1. Atomic write (tmp + fsync + rename) with `.bak`. UI warns about formatting loss. Comment-preserving round-trip is a v2 candidate.
- **Onboarding is all-or-nothing, no resume** — wizard state is in client memory; only step 4 commits. Two-minute flow doesn't justify resumability complexity.
- **Onboarding gating is client-side** — server returns `409 config-required` on mutating endpoints when config is absent. No HTTP redirects (which break POSTs and asset fetches).
- **CSRF + Origin hardening** — required even on localhost because browser tabs from arbitrary origins can hit `127.0.0.1`. Per-boot CSRF token + Origin allowlist + tight CSP. No CORS headers emitted.
- **AbortSignal threaded through the engine** — search routes own an `AbortController`; client disconnect aborts in-flight MCP and LLM calls. Existing engine code is updated to accept an optional `signal`.
- **Atomic pool swap** — MCP changes build a new pool, health-check, then swap under mutex. Old pool drains gracefully. No torn state during config edits.

## Resolved during review

The five questions from the original draft, settled after Opus + GPT + Gemini review:

1. **In-process for 5+ MCP fanouts** — sound. The fanout is async I/O. Synthesis uses streaming HTTP so it also yields. No worker thread needed for v1.
2. **Single repo / single package** — stay single. The underlying concern is dev-dep leak into the tarball; that's addressed by an explicit `files` allowlist + CI check, not by workspaces.
3. **Onboarding state persistence** — all-or-nothing. No resume, no sidecar file.
4. **Config editor YAML round-trip** — drop comment preservation. Edit-and-overwrite + auto-backup + UI warning.
5. **Auth tokens in config UI** — never accept literal values. Env-var references only; UI shows shell snippets.

Net additions from the review (not in the original draft):

- Origin allowlist + per-boot CSRF token + tight CSP (was missing entirely).
- `AbortSignal` threaded through the engine; client disconnect aborts in-flight calls.
- Atomic config writes (tmp + fsync + rename + `.bak`).
- Atomic MCP pool swap on config change.
- Shared types in `src/shared/` (avoids a cross-workspace import that would break standalone web builds).
- Client-side onboarding gating + `409 config-required` responses (replaces the originally-proposed server redirect, which would have broken POSTs and asset fetches).
