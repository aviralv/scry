# scry web frontend (v2) — design spec

**Date:** 2026-05-22
**Status:** Draft, pending user sign-off after Opus + GPT-5 + Gemini review
**Supersedes:** [2026-05-21-scry-web-frontend-design.md](./2026-05-21-scry-web-frontend-design.md) (engine pivot)
**Builds on:** scry CLI v0.1.3, Plan A foundation (W1–W2 + W4 already on `feat/web-foundation` branch)

---

## What changed from v1

The v1 spec built scry's GUI on top of the existing engine (`planner.ts` + `mcp-pool.ts` + `synthesizer.ts`). After reading the planner code we found the "deterministic fanout" framing didn't hold up — the planner just templated per-source query syntax and always called every configured MCP. Claude Code's agent loop does this better (skips irrelevant sources, supports follow-up turns, parallel tool use natively). v2 replaces scry's engine with [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and reshapes the GUI around a Perplexity-style search experience with a library sidebar.

## Goal

Add a localhost web GUI to scry, plus a thin headless CLI, both backed by a single engine that delegates to the Claude Agent SDK. The user surfaces are: streaming search with citations + source rail + follow-up thread, persistent library sidebar, MCP manager, registry editor, onboarding wizard, and a small preferences pane.

## Non-goals (v1)

- Multi-user / multi-tenant
- Remote (non-localhost) deployment
- Auth, sessions, or accounts
- Mobile-responsive layout
- Cross-platform Windows support (macOS / Linux only)
- Replacing the CLI

## Architecture

```
┌─────────────────── scry binary (Node) ────────────────────┐
│                                                            │
│  CLI: scry "<query>"            CLI: scry serve            │
│  ────────────────────           ───────────────            │
│  src/cli/headless.ts            src/cli/serve.ts           │
│        │                              │                    │
│        └──────────┬───────────────────┘                    │
│                   ▼                                         │
│         ┌─────────────────────┐                            │
│         │ src/engine/         │                            │
│         │  runQuery(opts)     │  ◀── builds systemPrompt   │
│         │  - Agent SDK query()│      from registry +       │
│         │  - mcpServers map   │      synthesis rules       │
│         │  - explicit cwd     │  ◀── ~/.config/scry/       │
│         │  - resume by id     │      (no global chdir)     │
│         └──────────┬──────────┘                            │
│                    │                                        │
│           ┌────────┴────────┐                              │
│           │                 │                              │
│   stdout (CLI)        fetch streaming (HTTP)               │
│                              │                              │
│                  ┌───────────▼─────────────┐               │
│                  │  src/server/ (Hono)     │               │
│                  │  /api/search   (stream) │               │
│                  │  /api/sessions          │               │
│                  │  /api/mcps              │               │
│                  │  /api/registry          │               │
│                  │  /api/preferences       │               │
│                  │  /api/onboarding        │               │
│                  │  static: dist/web/      │               │
│                  └───────────┬─────────────┘               │
│                              │                              │
│                  ┌───────────▼─────────────┐               │
│                  │ src/storage/sessions.ts │               │
│                  │   SQLite via            │               │
│                  │   better-sqlite3        │               │
│                  └─────────────────────────┘               │
└────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP + fetch streaming
                              ▼
                    ┌───────────────────────┐
                    │  React + Vite app     │
                    │  Perplexity-style     │
                    │  search + sidebar     │
                    └───────────────────────┘
```

### Single-process design

The Hono server runs in the same Node process as the engine. Routes call `runQuery()` directly. Long-running operations are async I/O (LLM and MCP traffic), so the event loop yields between awaits. No worker thread or subprocess for the engine.

`@modelcontextprotocol/sdk` stays as a narrow dep for one purpose: connection health-check in the MCP manager UI before adding to config (transient spawn → list tools → terminate).

### Streaming via fetch (not EventSource)

`POST /api/search` returns a `text/event-stream`-shaped body. **Clients use `fetch()` + `body.getReader()`**, not `EventSource`. EventSource only supports GET and can't send custom headers, which would break CSRF. With fetch streaming, the request can carry headers (CSRF, JSON body) and the client parses event blocks itself.

**Cancellation.** Each search route handler creates an `AbortController`. Its signal is passed to `runQuery({ signal })` which forwards to `query({ options: { abortController } })` from the SDK. When the client disconnects (`req.raw.signal` aborts in Hono), the route aborts its controller — the SDK terminates the agent loop and shuts down spawned MCP child processes within 1s. No orphan awaits, no zombie processes.

### Sessions, cold resume, and `cwd`

The Agent SDK persists conversation state to JSONL at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, where `<encoded-cwd>` is derived from the `cwd` option passed to `query()` (defaults to `process.cwd()`).

**scry passes `cwd: <scryConfigDir>` to every `query()` call.** The directory is computed once at process startup from the existing config-resolution chain (`$XDG_CONFIG_HOME/scry/` defaulting to `~/.config/scry/`). It's a constant for the lifetime of the process, but `process.cwd()` is **never mutated** — `process.chdir()` would mutate global state in ways that affect other modules and dependencies. The `cwd` is passed explicitly, scoped to the SDK call.

The cwd value is also stored alongside `session_id` in SQLite. In the unlikely event scry is later run with a different config directory, sessions from the previous cwd remain resumable because the resume call sends the original `cwd` back in.

### Security (carries from Plan A)

- Server binds `127.0.0.1` only.
- Origin allowlist (`http://localhost:6678`, `http://127.0.0.1:6678`, `http://[::1]:6678`).
- Per-boot CSRF token; required on `POST/PUT/PATCH/DELETE`. GET routes are read-only.
- Tight CSP on the SPA: `default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; script-src 'self'`.
- All config writes via `atomicWriteConfig` (tmp + fsync + rename + `.bak`).
- UI never accepts literal auth tokens; only env-var references.

### LLM endpoint via env vars (proxy-friendly)

- Agent SDK reads `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` from the environment. When set, all LLM traffic flows through the proxy (e.g. `http://localhost:6655/anthropic/`).
- scry calls `loadDotEnvFile(<scryConfigDir>/.scry.env)` before any `runQuery()` call so dotenv-supplied values are available to the SDK. (Existing behavior, carry forward.)
- Settings/Onboarding UI shows shell snippets for setting the env vars; never captures values.

## Engine module

```
src/engine/
├── runQuery.ts          # the single entry point — both CLI and server call this
├── system-prompt.ts     # composes systemPrompt from registry + synthesis rules
├── source-tracker.ts    # session-scoped source list; maps Claude's [N] markers
└── types.ts             # RunQueryOptions, RunQueryEvent, SourceCard, Citation
```

`runQuery(options)`: thin async-iterable wrapper around the SDK's `query()`.

```typescript
interface RunQueryOptions {
  prompt: string;
  config: ScryConfig;          // loaded scry.config.yaml
  scryConfigDir: string;       // absolute path; passed as `cwd` to the SDK
  signal?: AbortSignal;
  resume?: string;             // session_id from a prior turn
  fanoutMode?: boolean;        // adds a system-prompt directive
  priorSources?: SourceCard[]; // session's accumulated sources, for follow-up turns
}

type RunQueryEvent =
  | { type: 'session-init'; sessionId: string }
  | { type: 'tool-call'; tool: string; args: unknown }
  | { type: 'tool-result'; tool: string; sourceIndex: number }
  | { type: 'assistant-text'; text: string }
  | { type: 'citation'; index: number; source: SourceCard }
  | { type: 'done'; sessionId: string; sources: SourceCard[]; finalAnswer: string }
  | { type: 'error'; message: string };
```

**Internal flow:**
1. Idempotent `loadDotEnvFile` on `<scryConfigDir>/.scry.env`.
2. Build `systemPrompt` via `system-prompt.ts` (registry + synthesis rules + fanout directive if set).
3. Build `mcpServers` map from `config.mcp_servers` (env-var resolution via existing `resolveDeep`).
4. Construct an SDK `AbortController`, wired to `options.signal`.
5. Call `query({ prompt, options: { systemPrompt, mcpServers, cwd: scryConfigDir, resume, abortController } })`.
6. Initialize `source-tracker` with `priorSources` (empty for new sessions, populated for follow-ups).
7. As messages stream in, accumulate sources from `tool_result` blocks; assign `[N]` in arrival order within the session (numbering continues across follow-up turns).
8. When assistant text arrives, intercept `[N]` markers; emit `citation` events linked to the source list. Markers that don't map to a known source degrade to plain text.
9. Forward typed events to the caller. On `done`, include the full session source list and final answer for SQLite persistence.

`system-prompt.ts` — pure function `(registry, synthesisRules, fanoutMode) → string`. Three sections: scry's identity ("you are scry, a federated search assistant"), context (registry as JSON), output rules (citation format, parallel tool use directive, "if a source disagrees with another, surface that"). Tested in isolation.

`source-tracker.ts` — **session-scoped**, not per-turn. Receives the session's prior `SourceCard[]` plus the streaming `tool_result` messages from the current turn; produces a numbered list with stable `[N]` assignments. New entries get the next index in order of arrival. Validates `[N]` markers in assistant text against the list; drops invalid markers with a logged warning.

**MCP servers map translation** — scry's YAML `mcp_servers` block becomes the SDK's `mcpServers` argument. Env vars (`${VAR}` syntax) resolve via existing `resolveDeep` at config-load time.

## v1 surfaces

### Search + library sidebar (`/`)

**Layout:** library sidebar on left (collapsible), search pane on right.

```
┌───────────────┬────────────────────────────────────────┐
│ Library       │   Search Pane (Perplexity-shape)       │
│               │                                         │
│ ◌ scry        │   ┌────────────────────────────────┐   │
│   New search  │   │  What did Andre say about...?  │   │
│ ─────────     │   └────────────────────────────────┘   │
│ Today         │                                         │
│ ▸ EA roadmap  │   Sources                               │
│ ▸ Q4 planning │   ┌──────┐ ┌──────┐ ┌──────┐          │
│ Yesterday     │   │ 1.   │ │ 2.   │ │ 3.   │ ...      │
│ ▸ pricing pus…│   │ Slack│ │ Conf │ │ Mail │          │
│ Last week     │   └──────┘ └──────┘ └──────┘          │
│ ▸ Andre's...  │                                         │
│               │   Answer                                │
│               │   Andre is pushing to ship by EOQ [1],  │
│               │   though Dimitri raised concerns about  │
│               │   timeline [2]. The team aligned on...  │
│               │                                         │
│               │   [follow-up input]                     │
│               │                                         │
└───────────────┴────────────────────────────────────────┘
```

**Search behavior:**
- Empty state: input centered, no source rail, no answer.
- Submit → `POST /api/search` (fetch streaming) with `{ query, sessionId?, fanoutMode? }`.
- Server emits typed `RunQueryEvent`s (defined above). Client renders progressively:
  - `session-init` → store session_id, push optimistic entry into the sidebar
  - `tool-call` → status pip "Searching slack…" (collapsible)
  - `tool-result` → source card slides into the rail with its `[N]`
  - `assistant-text` → streaming text into the answer panel; `[N]` markers become hover-linked superscripts
  - `citation` → highlight/scroll to matching source card on hover/click
  - `done` → enable follow-up input; commit final state to SQLite
- **Citations stable across turns**: `[1]` rendered in turn 1 still refers to the same source after turn 3 adds `[5]`/`[6]`. The source-tracker is session-scoped.
- Follow-up: same endpoint with `sessionId` set; server adds `resume: sessionId` and `priorSources` to `runQuery`. Source rail extends, numbering continues.
- Abort: client closes the stream → server's `AbortController` fires → SDK terminates → MCP children die within 1s. Partial state already streamed stays on screen with a "Stopped" badge.
- Errors: stream `error` event → red banner + Retry. Sources captured pre-error remain visible.

**Library sidebar behavior:**
- Always visible in `scry serve` (collapsible to thin rail).
- Sessions grouped by relative time bucket: Today / Yesterday / Last week / Older.
- Each row: title (= first query, truncated to ~40 chars) + timestamp tooltip.
- Click row → loads `/api/sessions/:id` from SQLite (never reads the SDK's JSONL — that file format is internal to the SDK and only the SDK consumes it on `resume`). Renders saved query, source rail, final answer; enables follow-up input tagged with that `sessionId`.
- Hover row → "..." menu: Rename, Delete.
- Delete → confirm → `DELETE /api/sessions/:id` → row disappears from index. SDK's JSONL stays on disk (separate "Clear all sessions" preference can purge the JSONLs too — out of v1).
- "New search" button → clears the pane, no `sessionId`, fresh session on next submit.

**API surface:**

```
POST   /api/search                  fetch-stream of RunQueryEvents
                                     body: { query, sessionId?, fanoutMode? }

GET    /api/sessions                 list { id, title, summary, createdAt, updatedAt }[]
GET    /api/sessions/:id             { id, title, summary, query, finalAnswer, sources[] }
                                     — served entirely from SQLite
PATCH  /api/sessions/:id             { title? }
DELETE /api/sessions/:id             — removes from index (JSONL untouched)
```

**SQLite schema (sessions index, not transcript store):**

```sql
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,           -- Agent SDK session_id
  cwd          TEXT NOT NULL,              -- the cwd passed to query() — needed for resume
  title        TEXT NOT NULL,
  query        TEXT NOT NULL,              -- the first query (immutable)
  summary      TEXT,                       -- brief synthesis snippet for the sidebar
  final_answer TEXT,                       -- last assistant message; updated on follow-up
  sources_json TEXT,                       -- JSON-encoded session source list (stable [N])
  created_at   INTEGER NOT NULL,           -- ms epoch
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
```

WAL mode at boot. Writes happen on `done` event only — never per-token, so the streaming hot path doesn't touch the DB. Updates on follow-up `done` advance `updated_at`, refresh `final_answer` and `sources_json`.

**Out of v1:** sidebar filter/search, tags, spaces, sharing, session export, bulk delete.

### MCP manager (`/mcps`)

**Layout:** table of configured MCP servers — name, command/args, enabled toggle, last test status (green / red / never). "Add MCP" button opens a modal.

**Behavior:**
- `GET /api/mcps` → list from `scry.config.yaml#mcp_servers`.
- `POST /api/mcps` → add. Server runs a transient health-check via `@modelcontextprotocol/sdk` (spawn → list tools → terminate) before committing. Reject with structured error if it fails.
- `PATCH /api/mcps/:name` → edit. Same health-check on save.
- `DELETE /api/mcps/:name` → remove.
- `POST /api/mcps/:name/test` → on-demand health-check.
  - **5s default timeout.** Hung child killed with process-group SIGTERM, then SIGKILL after 200ms grace.
  - Spawn env contains only the MCP's declared env-var refs + a small allowlist (`PATH`, `HOME`); no shell env leak.
  - Returns `{ ok, toolCount, error? }`.
- All writes via `atomicWriteConfig`. Agent SDK reads the new config on the next `runQuery` call; no atomic-pool-swap dance is needed (SDK manages its own MCP processes per session).
- Env-var refs only (no literal values).

**Out of v1:** auto-discovery from PATH (only shown in onboarding), per-tool overrides, MCP marketplace.

### Registry editor (`/registry`)

**Layout:** two tabs — People, Projects.

**People rows:** key, display name, aliases (chips), identifiers (email, slack handle, etc.).

**Project rows:** key, display name, aliases, routing block (slack_channels, jira_project, confluence_cql).

**Behavior:**
- `GET /api/registry` → returns `{ people, projects }` from `scry.config.yaml#registry`.
- `PUT /api/registry` → atomic write. Schema-validated (zod) before write.
- Edit-and-overwrite at the `registry` block; comments outside that block are preserved by serializing only the registry sub-tree on update. Comments inside the registry are subject to YAML-serializer reformatting; UI shows a "comments may be reformatted" warning above Save.

**Out of v1:** import from contacts, autocomplete from Slack workspace, drag-to-reorder.

### Onboarding wizard (`/onboarding`)

**3 steps.**

1. **Auth check.** Server probes `process.env.ANTHROPIC_AUTH_TOKEN` and `process.env.ANTHROPIC_BASE_URL`. Reports presence (no API call required).
   - If either missing, UI shows the copyable shell snippet:
     ```bash
     echo "ANTHROPIC_AUTH_TOKEN=..." >> ~/.config/scry/.scry.env
     echo "ANTHROPIC_BASE_URL=http://localhost:6655/anthropic/" >> ~/.config/scry/.scry.env
     chmod 600 ~/.config/scry/.scry.env
     ```
     "I've set them" button → reload `.scry.env` in-process → re-check.
   - Optional **"Test token"** button → makes one tiny API call (a 1-token completion) to verify the credential actually works. Rate-limited to 1 click per 30s.
2. **MCP setup.** Server scans PATH for bundled servers (`slack-mcp`, `ms365-intent-mcp`, `confluence-jira-mcp`); UI shows a toggle for each found.
   - For each toggled-on server, lists the env vars it needs (from scry's `bundled-servers.ts` metadata) with placeholder names. UI shows shell snippets; never captures values.
3. **Done.** Atomically write `<scryConfigDir>/scry.config.yaml`: `llm: {}` (env-driven), `mcp_servers: <selected>`, empty `registry`, default `search_tools` from bundled-servers metadata. Link to search.

**Gating (client-side, not server redirect):**
- `GET /api/onboarding` returns `{ configExists, authPresent, baseUrlSet, bundledMcps: [...] }`.
- SPA always loads. If `configExists === false`, the SPA routes the user to `/onboarding`.
- Server-side: every mutating non-onboarding API endpoint returns `409 config-required` when no config is found. The SPA catches that and routes to onboarding. No HTTP redirects (which would break POSTs and asset fetches).

**Out of v1:** importing config from another machine, OAuth-style MCP auth, populating registry during onboarding.

### Preferences pane (`/preferences`)

**Layout:** single page.

| Section | Fields |
|---|---|
| Theme | dark / light toggle |
| Search defaults | "Always fanout mode" toggle (default off) |
| LLM endpoint *(read-only)* | `ANTHROPIC_BASE_URL` value or "default (api.anthropic.com)" + auth-token presence |
| Bundled MCPs *(read-only)* | each bundled server: detected on PATH / not found |
| Re-check button | runs the same scan as `/api/onboarding` |

**Storage:** user-controllable fields persist to `<scryConfigDir>/preferences.json` — separate file from `scry.config.yaml`, different concern, different cadence. Theme is also written to `localStorage` for instant flash-of-no-theme avoidance on page load.

**API:**
- `GET /api/preferences` → user prefs + read-only env/bundled status
- `PUT /api/preferences` → write `{ theme, fanoutMode }` only. Read-only fields ignored.

## Repo layout

```
scry/
├── src/
│   ├── cli/
│   │   ├── headless.ts            # NEW — scry "<query>" enters here
│   │   ├── serve.ts               # NEW — scry serve enters here
│   │   ├── init.ts                # existing, kept for parity (CLI init wizard)
│   │   └── index.ts               # NEW — commander setup, dispatches to subcommands
│   │
│   ├── engine/                    # NEW — replaces src/core/*
│   │   ├── runQuery.ts
│   │   ├── system-prompt.ts
│   │   ├── source-tracker.ts
│   │   └── types.ts
│   │
│   ├── server/                    # extends Plan A foundation
│   │   ├── index.ts               # createServer
│   │   ├── boot.ts                # listen + open browser
│   │   ├── middleware/
│   │   │   ├── origin.ts
│   │   │   ├── csrf.ts
│   │   │   └── csrf-token.ts
│   │   ├── routes/
│   │   │   ├── search.ts          # POST /api/search → fetch stream
│   │   │   ├── sessions.ts        # GET/PATCH/DELETE
│   │   │   ├── mcps.ts            # CRUD + /:name/test
│   │   │   ├── registry.ts        # GET/PUT
│   │   │   ├── preferences.ts     # GET/PUT
│   │   │   ├── onboarding.ts      # GET state, POST commit
│   │   │   ├── health.ts
│   │   │   └── csrf.ts
│   │   ├── static.ts              # serves dist/web/, injects CSRF token
│   │   └── stream.ts              # event-stream helpers
│   │
│   ├── storage/                   # NEW
│   │   ├── sessions.ts            # SQLite via better-sqlite3
│   │   └── preferences.ts         # JSON read/write
│   │
│   ├── config/
│   │   ├── loader.ts              # existing — resolveConfigPath
│   │   ├── dotenv.ts              # existing
│   │   ├── types.ts               # extend with registry/preferences shapes
│   │   ├── bundled-servers.ts     # existing
│   │   └── atomic-write.ts        # from Plan A (W2)
│   │
│   └── shared/
│       └── types.ts               # from Plan A (W1) — extend as needed
│
├── web/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                # router shell with sidebar layout
│       ├── theme/
│       │   ├── tokens.css         # ~25 CSS vars
│       │   └── index.css          # tailwind + token import
│       ├── routes/
│       │   ├── Search.tsx
│       │   ├── McpManager.tsx
│       │   ├── Registry.tsx
│       │   ├── Preferences.tsx
│       │   └── Onboarding.tsx
│       ├── components/
│       │   ├── LibrarySidebar.tsx
│       │   ├── AnswerStream.tsx
│       │   ├── SourceCard.tsx
│       │   ├── McpAddModal.tsx
│       │   └── …
│       └── lib/
│           ├── csrf.ts
│           ├── api.ts
│           └── stream.ts          # fetch streaming consumer
│
├── dist/
└── package.json
```

**Removed from current scry**: `src/core/{planner,mcp-pool,normalizer,synthesizer,registry,detector}.ts` and their tests. Some logic (registry shape, bundled-servers metadata, CLI orchestration) migrates into the new modules.

**Dependency changes**:
- Add: `@anthropic-ai/claude-agent-sdk` (pinned), `better-sqlite3`, `@types/better-sqlite3`
- Keep: `@modelcontextprotocol/sdk` (narrow, MCP manager test), `hono`, `@hono/node-server`, `zod`, `open`, `commander`, `yaml`
- Remove: `@anthropic-ai/sdk` (Agent SDK supersedes), `@inquirer/prompts` (CLI init wizard goes away if onboarding is browser-only — confirm during plan)

## Visual identity

Carries forward unchanged from v1: cool teal `#3aa39c` accent on `#0c0e10` background; Inter for sans, JetBrains Mono for mono; dark + light themes via `[data-theme="light"]` and ~25 CSS variables in `web/src/theme/tokens.css`. Rebrand surface is one file edit.

## Dev workflow

- `npm run dev` — tsc watch on server, Vite dev server on `:5173` proxying `/api/*` → `:6678`
- `npm run build` — `tsc` (server) + `cd web && vite build` (frontend → `../dist/web/`)
- Production: `npm i -g @aviralv/scry`, `scry serve` boots single-process server on `:6678`, opens browser.

## Testing

| Layer | Tooling | Focus |
|---|---|---|
| Engine (`runQuery`, `system-prompt`, `source-tracker`) | vitest, mocked Agent SDK | citation determinism + stability across turns, system-prompt composition, abort plumbing |
| Server routes | vitest + Hono `app.request()` | each route happy + error path; CSRF enforcement; origin reject |
| Storage | vitest, temp dirs | SQLite schema, atomic writes |
| Frontend components | vitest + Testing Library | streaming render, citation hover, sidebar interactions, modals |
| E2E | Playwright | `scry serve` boots; query produces an answer with citations; follow-up resumes session; cold restart still resumes |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agent SDK API instability (pre-1.0) | Pin exact version; SDK upgrades land as separate plans with manual review |
| `better-sqlite3` native rebuild on Node version change | Document supported Node range; rely on better-sqlite3's prebuilt binaries |
| Cold session resume needs original `cwd` | Pass `cwd` explicitly to `query()`; store `cwd` alongside `session_id` in SQLite |
| MCP child-process zombies on abort | Acceptance test: spawn → abort → verify no orphaned children after 1s |
| Citation `[N]` markers don't map | source-tracker drops unmapped markers + logs warning; renders as plain text |
| `.scry.env` not loaded before SDK reads env | `runQuery` calls `loadDotEnvFile` first (existing scry behavior) |
| Stream stalls on long synthesis | Server emits keep-alive comments every 15s; client treats `error` as recoverable |
| Cross-origin tab fires requests at `localhost:6678` | Origin allowlist + CSRF (Plan A) |
| Config edits via UI corrupt YAML formatting | atomicWriteConfig with `.bak`; schema validation before write; UI warns about formatting loss |
| MCP `/test` hangs indefinitely | 5s timeout, process-group SIGTERM then SIGKILL, env-var allowlist |

## Acceptance criteria

- `scry serve` boots a localhost server, opens browser to search (or `/onboarding` if no config).
- A search returns the same kind of answer in the GUI as the CLI for the same query — both via the Agent SDK with the same registry and synthesis prompt.
- Streaming answer renders progressively; inline `[N]` markers link to source cards on hover and on click. Markers that don't map to a source appear as plain text.
- **Citations stable across follow-ups**: an `[N]` rendered in turn 1 continues to refer to the same source after turn 3 adds new citations.
- Closing the browser tab mid-search aborts within 1s; no zombie MCP child processes survive.
- Follow-up turn resumes the same Agent SDK session (`resume: sessionId`); source rail extends, sidebar entry's `updated_at` advances, prior `[N]` numbering preserved.
- Library sidebar lists past sessions; clicking one re-loads from SQLite (not JSONL); follow-up still works.
- Cold restart: `scry serve`, exit, `scry serve` again, click any past session → follow-up resumes (verifies `cwd` round-trip + JSONL durability).
- `scry "<query>"` (CLI) hits the same engine, prints answer + citations to stdout.
- MCP manager: add an MCP via UI → health-check passes → atomic write to config → next search uses it.
- MCP `/test` endpoint: hung server killed within 5s; structured error returned; no orphan processes.
- Registry editor: editing a project's slack channels persists; the next search referencing that project produces a system prompt containing the edited routing.
- Onboarding: a no-config user gets routed to `/onboarding`; after step 3, search works without ever editing YAML by hand.
- Onboarding "Test token" button (when clicked): performs one 1-token API call; rate-limited to 1 per 30s; shows result.
- Search transport: `/api/search` is consumed via `fetch()` + `body.getReader()` (not `EventSource`); CSRF header present on the request.
- Cross-origin requests rejected (Origin check). Mutating routes without `X-Scry-Csrf` rejected.
- `npm pack --dry-run` shows only `dist/` and `README.md`.
- Hyperspace proxy works: setting `ANTHROPIC_BASE_URL` in `.scry.env` routes all LLM traffic through the proxy.
- `process.cwd()` is **never** mutated by scry's startup or any of its routes (verified in tests).

## Decision log

- **Engine pivot to `@anthropic-ai/claude-agent-sdk`.** Reading scry's planner showed "deterministic fanout" was always-call-all + per-source query templates. Agent SDK's loop is smarter (skips irrelevant sources), supports follow-up turns, and parallel tool use is native.
- **Single engine, two transports.** `runQuery()` is the sole entry point. CLI streams to stdout; server streams to the GUI via fetch streaming. No dual implementations.
- **Cold resume validated.** SDK persists JSONL at `~/.claude/projects/<encoded-cwd>/<id>.jsonl`. scry passes `cwd: <scryConfigDir>` explicitly to every `query()` call. SQLite stores only the sidebar index.
- **No global `process.chdir`.** v1 of this spec proposed mutating cwd at boot for "stable JSONL paths". Reviewers correctly flagged the side effects (relative paths in deps, testing pain). The SDK's `Options.cwd` parameter (verified at `sdk.d.ts:1283`) makes the chdir hack unnecessary.
- **Fetch streaming, not EventSource.** Browsers' `EventSource` can't send custom headers, breaking CSRF. Search uses `fetch()` + `body.getReader()` to parse `text/event-stream`-shaped responses, which allows the CSRF header.
- **Citation tracker is session-scoped.** Numbering continues across follow-up turns; an `[N]` from turn 1 is stable for the life of the session. State persists in `sessions.sources_json`.
- **GET `/api/sessions/:id` reads from SQLite only.** SDK's JSONL is consulted only by the SDK on `resume`. The JSONL format is internal to the SDK; we don't couple to it.
- **No literal token entry from UI.** Env-var references only. Onboarding step 1 has an optional "Test token" button (1-token API call, rate-limited).
- **MCP `/test` timeout + process-group kill.** 5s default timeout; SIGTERM then SIGKILL after 200ms; env-var allowlist (no shell env leak).
- **SQLite via better-sqlite3 for the sidebar index only.** Index rows are tiny (~10KB even with sources). Writes happen on `done` (not per-token), so the streaming hot path doesn't touch the DB. WAL mode at boot.
- **CLI kept as headless flavor.** XDG fix from v0.1.3 is preserved; `scry "..." | jq` ergonomics work.
- **Hono + React + Vite + Tailwind retained.** Six surfaces is more state than vanilla can carry cleanly. Tailwind layered on CSS variables for one-file rebrand.
- **macOS / Linux only.** Cross-platform Windows is an explicit non-goal.

## Dismissed reviewer points (so they don't come back)

- **GPT-5 "Windows abort semantics"** — explicit non-goal; macOS/Linux only.
- **Gemini "SDK adapter / facade layer"** — premature abstraction per project CLAUDE.md. The version-pinning + narrow surface gives us enough insulation; abstraction can come if the SDK actually breaks.
- **Gemini "worker threads for SQLite"** — overkill at this scale; index rows are tiny, no FTS, no complex joins. Profiling can revisit if it ever matters.
- **Gemini "feature sprawl: consolidate MCP + Registry"** — the user explicitly chose all four non-search surfaces during brainstorming. Stays.
- **GPT "JSONL GC for deleted sessions"** — defer; "manage storage" preference can land in v2.
- **GPT "blocking DB in stream path"** — already addressed: writes only on `done`, never per-token.
- **GPT "YAML comment preservation"** — already softened: "edit and overwrite + warn + auto-backup". Comment preservation isn't a v1 promise.
- **GPT "session index lifecycle ambiguity"** — clarified: insert on `session-init` event (optimistic), commit content on `done`. Updates on follow-up `done`. CLI-only sessions also write to the index (CLI calls the same `runQuery`, which emits `session-init`).
- **GPT "source mapping race conditions"** — assignment rule is "in order of `tool_result` arrival within the session". The streaming order is what we use; no parallel race because the SDK serializes `tool_result` blocks per session.
- **GPT "MCP test inheriting sensitive env"** — env-var allowlist enforced (only declared refs + `PATH`/`HOME`).

---

End of design.
