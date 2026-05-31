# scry web frontend — Plans E + F (config-editing surfaces) — design spec

**Date:** 2026-05-29
**Status:** Draft, pending user approval
**Builds on:** [v2 design](./2026-05-22-scry-web-frontend-v2-design.md), Plans A/B/C1/C2/C3 merged on `main`
**Reviewed by:** Claude (author), GPT-4.1 (adversarial — GPT-5 family unreachable through proxy)

---

## Goal

Add two browser surfaces to scry that edit `~/.config/scry/scry.config.yaml`:

- **`/mcps` — MCP manager** — table of configured MCP servers; add / edit / delete / on-demand health-check.
- **`/registry` — Registry editor** — People + Projects tabs; one-shot save of the entire registry block.

Both surfaces share atomic-write + zod-validation infrastructure. Both compose with the existing flex shell (`LibrarySidebar` + main pane). Plans G (onboarding) and H (preferences) are deferred to a separate spec; they will reuse the form components and atomic-write helper built here.

## Non-goals

- Plan G (onboarding) and Plan H (preferences) — separate spec
- Auto-discovery of MCP servers from PATH (lives in onboarding G)
- MCP marketplace, per-tool overrides, OAuth-style MCP auth
- Registry import from contacts, autocomplete from Slack workspace, drag-to-reorder
- Multi-user / multi-tenant; cross-process *registry edits from scry's own CLI* are not coordinated beyond the file lock (see "Concurrency").
- Comment preservation guarantees beyond the top-level `registry:` block boundary

## Architecture

### Shared infrastructure

Both surfaces flow through one validate-then-write helper:

```
src/config/
├── schema.ts          NEW — zod for McpServerConfig, Person, Project, Registry
├── write-config.ts    NEW — read → merge → validate → file-lock → atomic write
└── ...existing...
```

`writeConfig(updates: Partial<ScryConfig>): Promise<void>`:

1. Acquire a cross-process file lock on `~/.config/scry/scry.config.yaml.lock` via `proper-lockfile` (covers the full read-modify-write, not just the rename).
2. Read current YAML into a `yaml.Document`.
3. Merge: `mcp_servers` and `registry` blocks are *fully replaced* with the supplied subtree (deep-merge would silently drop deleted entries). Other top-level keys untouched.
4. Validate the merged result with the corresponding zod schema. On failure, throw a `ValidationError` carrying `{ errors: ZodIssue[] }`.
5. Call existing `atomicWriteConfig` (tmp + fsync + rename + `.bak`).
6. Release the lock in a `finally`.

The single-flight in-process latch is unnecessary now that we hold a file lock — the lock is reentrant per process anyway. **One write path. No bypass.**

`schema.ts` exports zod schemas reused server-side (validate before write) and client-side (form errors). Single source of truth.

### Routing

Add `react-router-dom` v6 to `web/package.json`. `App.tsx` wraps the existing flex layout in `<BrowserRouter>`:

```tsx
<BrowserRouter>
  <div className="flex h-screen">
    <LibrarySidebar ... />
    <Routes>
      <Route path="/" element={<Search ... />} />
      <Route path="/mcps" element={<McpManager />} />
      <Route path="/registry" element={<Registry />} />
    </Routes>
  </div>
</BrowserRouter>
```

`LibrarySidebar` gains a small **nav header** above "+ New search" with three `NavLink`s (Search · MCPs · Registry). Active route highlighted via `NavLink`'s `isActive`. The session list stays visible on every route — switching to MCPs/Registry shouldn't lose your session context.

CSRF and origin enforcement carry through unchanged. The `csrfRequired` middleware is already mounted globally on the Hono app (see `src/server/index.ts` from Plan A); new routes inherit it. We add per-route CSRF-rejection tests for `/api/mcps` and `/api/registry` defensively.

### Error response shape (locked in)

All 4xx responses carry a structured error body. This shape is shared by both routes and lets the frontend map server-side zod failures back to specific row/field errors:

```ts
type ApiErrorBody = {
  error: string;                                  // human-readable summary
  errors?: Array<{ path: string[]; message: string }>;  // path-scoped (zod-shaped)
};
```

Status codes used here:

| Code | Meaning |
|---|---|
| 400 | Validation failed; `errors[]` populated with path-scoped issues |
| 403 | CSRF / origin rejection |
| 404 | Named entity not found (e.g. PATCH/DELETE on missing MCP) |
| 409 | True conflict — e.g. POST `/api/mcps` with an existing name |
| 412 | Precondition failed — `scry.config.yaml` does not exist yet (used by **both GET and PUT** for consistency) |
| 422 | Operation refused after validation — health-check failed |

`409` is reserved for true conflicts. `412` replaces the v2 spec's "409 config-required" double-use, applied uniformly to GET and PUT/POST/PATCH so the frontend never has to handle a "GET-but-empty-then-PUT-then-rejected" UX hole.

## Plan E — MCP manager

### Server: `src/server/routes/mcps.ts`

```
GET    /api/mcps                 → 200 { servers: McpServerEntry[] } | 412 config-required
POST   /api/mcps                 body: { name, command, args?, env?, enabled? }
                                  → 201 { server } | 400 | 409 name-exists | 422 health-check-failed | 412
PATCH  /api/mcps/:name           body: partial { command?, args?, env?, enabled? }
                                  → 200 { server } | 400 | 404 | 422 health-check-failed | 412
DELETE /api/mcps/:name           → 204 (idempotent — 204 on missing too)
POST   /api/mcps/:name/test      → 200 { ok: true, toolCount } | 200 { ok: false, error } | 404 | 412
```

```ts
type McpServerEntry = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;        // defaults true; runQuery omits disabled entries from mcpServers map
};
```

`enabled` is added to `McpServerConfig` (defaults `true`). `runQuery`'s mcpServers-map builder filters out `enabled: false` entries.

POST and PATCH **both call `healthCheck` before `writeConfig`**. Health-check failure → `422`, no write. The `/:name/test` endpoint is the same call without a write.

DELETE is idempotent: 204 on success, 204 on missing. Frontend's optimistic-delete depends on this.

### Health-check helper: `src/server/mcp-health.ts`

Pure function `healthCheck(server: McpServerConfig, opts?: { timeoutMs?: number }): Promise<{ ok: boolean, toolCount?: number, error?: string }>`. 5s default timeout.

**Process management — three things must be right:**

1. **Detached spawn.** We call `child_process.spawn(command, args, { detached: true, stdio: ['pipe','pipe','pipe'], env: <built env> })` ourselves and then construct `StdioClientTransport` over the resulting stdio streams (or, if the SDK doesn't expose this seam, we wrap our own minimal stdio MCP client — see Risks). The child gets its own process group via `setsid()` (POSIX `detached`). On timeout, we `process.kill(-child.pid, 'SIGTERM')` to reach the *child's* PGID, never scry's. SIGKILL after 200ms grace.

2. **In-flight promise rejection.** When the timeout branch wins, the `client.listTools()` promise is still pending. Before calling `transport.close()`, we explicitly reject any in-flight SDK promise so cleanup doesn't race with a pending await.

3. **Env allowlist (closed, not regex-based).** The spawn env is constructed as:
   ```
   {
     PATH: process.env.PATH,
     HOME: process.env.HOME,
     ...resolveDeclaredRefs(server.env ?? {}, allowedRefs)
   }
   ```
   `allowedRefs` = the set of env-var names referenced in *this MCP entry's* `env` block. **A `${VAR}` reference resolves only if `VAR` is one of the keys the user named in the same entry.** This means `env: { TOKEN: "${SLACK_TOKEN}" }` works (TOKEN is a declared key referencing SLACK_TOKEN — but `SLACK_TOKEN` must be in the user's environment); it does NOT mean a user can sneak `env: { LEAK: "${AWS_SECRET_ACCESS_KEY}" }` into a third-party MCP because the regex happens to allow uppercase letters.

   Concretely: the validator (zod) accepts the value-shape `${UPPER_CASE_NAME}`; but the runtime resolver checks each `${REF}` against the per-entry `allowedRefs` set, which is the user's own list of intended variables. Users opt in to leaking by naming the var.

The frontend Save button + all form fields are **disabled while `submitting` is true** so a double-click can't fire two POSTs.

### Frontend: `web/src/routes/McpManager.tsx`

Full-pane table:

| Name | Command | Args | Status | Enabled | Actions |
|---|---|---|---|---|---|
| slack | `slack-mcp` | — | 🟢 OK | ✓ | Edit · Test · Delete |
| ms365 | `ms365-intent-mcp` | — | ⚠️ Never tested | ✓ | Edit · Test · Delete |

**+ Add MCP** opens `McpAddModal` (reused for Edit). Fields: `name` (text, slug shape), `command` (text), `args` (textarea, one per line), `env` (key/value rows, value validated as `${UPPER_NAME}` only via UI; backend accepts the safe-literal alternative for hand-edited configs), `enabled` (checkbox, default true).

`lastTestStatus` is **in-memory only** in v1 (per SPA session). On reload it resets to "Never tested." Persistence is a follow-up if it matters.

Delete shows `window.confirm("Delete MCP \"<name>\"?")`. Optimistic remove from the table; if the API errors (network), a banner restores the row.

Components added:
- `web/src/routes/McpManager.tsx` — table + state + handlers
- `web/src/components/McpAddModal.tsx` — add/edit modal
- `web/src/components/McpRow.tsx` — one row + status pill + actions
- `web/src/lib/mcps.ts` — typed API client (`listMcps`, `createMcp`, `updateMcp`, `deleteMcp`, `testMcp`)

**412 handling:** If GET returns 412, the route renders an empty state: "Run scry through onboarding first to create your config." (Stub link to `/onboarding` — that route lands in spec #2.)

## Plan F — Registry editor

### Type addition

Extend `Person` in `src/config/types.ts`:

```ts
export interface Person {
  name: string;
  role?: string;
  teams?: string[];
  aliases?: string[];   // NEW — for chips UI; v2 spec called for it but type lacked the field
  identifiers: PersonIdentifiers;
  projects?: string[];
}
```

### Server: `src/server/routes/registry.ts`

```
GET    /api/registry          → 200 { registry: Registry } | 412 config-required
PUT    /api/registry          body: { registry: Registry }
                                → 200 { registry } | 400 | 412 config-required
```

Both verbs return 412 when `scry.config.yaml` is absent — **consistent across GET and PUT** so a no-config user sees the same gate on both load and save (no UX hole where the form populates with empty data and then the save fails).

PUT validates with zod, then calls `writeConfig({ registry })`. Comments outside the `registry:` block are preserved by re-serializing only the registry sub-tree via `yaml`'s Document API. **Comments inside the registry block are deleted on save** — not "reformatted." The UI warns explicitly: "Comments inside the registry block will be deleted on save. Edit `scry.config.yaml` directly if you want them preserved." We do not attempt string-splicing as a fallback (brittle, fails on non-canonical formatting).

### Frontend: `web/src/routes/Registry.tsx`

Two tabs: **People** | **Projects**, with active tab in URL (`?tab=people` / `?tab=projects`) so refresh keeps you in place.

Each row collapsed by default; chevron expands to inline edit form (name, role, teams chips, aliases chips, identifiers — slack_username/email/confluence_username, projects chips for People; routing block — slack_channels chips, jira_project, confluence_cql — for Projects).

**Working-copy state machine:**
- `working: Registry` — local editable copy
- `server: Registry` — last-saved server state, used for "Discard"
- `dirty: Set<string>` — keys of rows that differ from `server`

A single **"Save changes"** button at the route's top-right commits `working` via PUT. **No per-row PUTs** — atomic write means the whole registry is replaced anyway.

**On 400:** the response's `errors[]` (path-scoped) feeds row-level error rendering. Each row component receives `errors: ApiError[]` filtered to its own path prefix (`["people", "alice", ...]` for the row keyed `alice`) and renders inline field errors. A summary banner above the tabs shows "Validation failed — N errors below." Working copy stays dirty so the user can fix and re-save.

**On 200:** UI replaces `working` and `server` with the response. Dirty set clears.

Components added:
- `web/src/routes/Registry.tsx` — tabs + working copy + save/discard
- `web/src/components/PersonRow.tsx`
- `web/src/components/ProjectRow.tsx`
- `web/src/components/ChipsInput.tsx` — generic chip input (teams, aliases, projects, slack_channels)
- `web/src/lib/registry.ts` — typed API client
- `web/src/lib/registry-validation.ts` — re-export of the shared zod schema for browser

Warning above Save: "Comments inside the registry block will be deleted on save."

**412 handling:** Same empty state as `/mcps`.

## Concurrency

| Scenario | Behavior |
|---|---|
| Two browser tabs of `/registry` save simultaneously | `proper-lockfile` serializes the writes; second write reads the post-first state; **last write wins** (no version field — single-user spec). |
| `/registry` PUT while `/mcps` POST is in flight | Both block on the same lockfile; serialized; both succeed if validation passes. |
| `scry serve` running while user `vim`s `scry.config.yaml` | scry's PUT blocks on the file lock; the vim write is not coordinated (vim isn't lock-aware), so this is "last write wins" between scry and vim. Documented as a non-goal: "don't hand-edit the file while scry serve is running." |
| scry serve crashes mid-write | `proper-lockfile` is auto-released on process exit. `atomicWriteConfig`'s tmp+rename means the on-disk file is either old-good or new-good. `.bak` carries the prior state if recovery is needed. |

## Validation rules (zod, locked in)

```ts
// schema.ts
const ENV_REF = /^\$\{[A-Z][A-Z0-9_]*\}$/;
const SAFE_LITERAL = /^[A-Za-z0-9._/=:@+-]+$/;        // no shell metachars
const SLUG = /^[a-z][a-z0-9_-]{0,63}$/;

McpServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string().regex(new RegExp(`(${ENV_REF.source})|(${SAFE_LITERAL.source})`))).optional(),
  enabled: z.boolean().optional(),
});

PersonSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  teams: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  identifiers: z.object({
    slack_username: z.string().optional(),
    email: z.string().email().optional(),
    confluence_username: z.string().optional(),
  }).default({}),
  projects: z.array(z.string()).optional(),
});

ProjectSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  routing: z.object({
    slack_channels: z.array(z.string()).optional(),
    confluence_cql: z.string().optional(),
    jira_project: z.string().optional(),
  }).default({}),
  people: z.array(z.string()).optional(),
});

RegistrySchema = z.object({
  people: z.record(z.string().regex(SLUG), PersonSchema),
  projects: z.record(z.string().regex(SLUG), ProjectSchema),
});
```

Notes:
- `env` value regex permits `${UPPER_NAME}` refs OR safe literals. **The runtime resolver enforces the per-entry allowlist** — see "Health-check helper" above. The regex alone is not the security boundary.
- `SAFE_LITERAL` allows `/` because some MCP servers take path values; this is a forwarded env var, not a path the file system reads, so traversal isn't a concern. Documented.
- Top-level registry keys must match `SLUG`. Lowercase, hyphenated identifiers only.

## Repo layout (additions)

```
src/
├── config/
│   ├── schema.ts                  NEW
│   └── write-config.ts            NEW
└── server/
    ├── mcp-health.ts              NEW
    └── routes/
        ├── mcps.ts                NEW
        └── registry.ts            NEW

web/src/
├── routes/
│   ├── McpManager.tsx             NEW
│   └── Registry.tsx               NEW
├── components/
│   ├── McpRow.tsx                 NEW
│   ├── McpAddModal.tsx            NEW
│   ├── PersonRow.tsx              NEW
│   ├── ProjectRow.tsx             NEW
│   └── ChipsInput.tsx             NEW
└── lib/
    ├── mcps.ts                    NEW
    ├── registry.ts                NEW
    └── registry-validation.ts     NEW
```

`App.tsx` and `LibrarySidebar.tsx` modified to add `<BrowserRouter>` and the nav header.

**Dependencies added:**
- `react-router-dom` v6 (web)
- `proper-lockfile` (server)

## Testing

| Layer | What's covered |
|---|---|
| `src/config/schema.test.ts` | Each schema's happy path + key validation failures (slug shape, missing required, type mismatch). |
| `src/config/write-config.test.ts` | Read→merge→validate→write round-trip; concurrent writes serialize via lock; validation short-circuits before any fs touch; YAML comments outside `registry:` block survive a registry PUT (golden test). |
| `src/server/mcp-health.test.ts` | Spawns three fixture servers (ok / hang / immediate-error); verifies returned shape; **PID-checked: hung child is dead within 1s of timeout via SIGKILL**; verifies env passed to child contains only allowlisted refs (fixture echoes `process.env`). |
| `src/server/routes/mcps.test.ts` | GET (incl. `enabled: false` rows); POST happy / 400 / 409 / 422 (mock health-check) — assert no fs write on 422; PATCH happy / 404 / empty body 400; DELETE 204 on missing (idempotent); `:name/test` returns shape without writing config; CSRF rejection on each verb. |
| `src/server/routes/registry.test.ts` | GET happy + 412; PUT happy + 400 (with path-scoped errors[]); 412 on PUT when no config; comment-preservation golden test on top-level. |
| `web/src/components/ChipsInput.test.tsx` | Add via Enter / comma; remove via backspace on empty; click X. |
| `web/src/routes/McpManager.test.tsx` | Empty state on 412; row render; Edit opens modal pre-filled; Add modal — Save fields disabled while submitting; 422 keeps modal open with error; Delete → confirm → row removed. |
| `web/src/routes/Registry.test.tsx` | Tab in URL; dirty-dot tracking; Save fires PUT; **server 400 with path-scoped errors maps to row-level error rendering**; Discard reverts to server state. |

E2E (deferred to Plan I): add an MCP via UI → row appears OK → search uses the new MCP. Edit a project's slack_channels → next search's system prompt contains the routing.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `StdioClientTransport` doesn't expose stdio seam for `detached: true` | Spawn the child ourselves; if the SDK insists on owning the spawn, write a minimal MCP stdio client (initialize + listTools is ~80 lines). Verified during plan execution. |
| `proper-lockfile` stale-lock if a previous scry crashed | The library handles staleness via `fs.stat` mtime checks; default `stale: 10000` (10s) is fine. |
| `yaml.Document` reformats array/string styles inside the registry block | Documented; warning above Save says comments are deleted; non-comment cosmetic reformatting is acceptable. |
| User hand-edits config while scry serve is running | Documented non-goal; lockfile only protects scry's own writes. |
| zod schema drift between server and client | Single `schema.ts` re-exported through `web/src/lib/registry-validation.ts`; build fails if the import path breaks. |
| Health-check hang on a malformed MCP that ignores stdio | `Promise.race` timeout fires; PGID-targeted SIGKILL kills the child after 200ms grace. |

## Acceptance criteria

- `/mcps`: add an MCP whose command resolves on PATH and exposes ≥1 tool → 201, row appears with status OK; running a search uses the new MCP.
- `/mcps`: add an MCP with a hanging command → 422 within 5.5s; **scry's own PID is unaffected**; child PID is dead within 1s of the 422 (verified in test).
- `/mcps`: env value `MY_TOKEN: "${HOME}"` (where `HOME` is *not* listed as a key in the same entry's `env` block) → resolver returns the literal string `"${HOME}"` (refuses to leak the host `HOME`). Env value `MY_TOKEN: "${SLACK_TOKEN}"` where the same entry declares `SLACK_TOKEN: "..."` (or where `SLACK_TOKEN` is in `allowedRefs` per project policy) → resolved from `process.env.SLACK_TOKEN`. The allowlist is the union of (a) keys the user listed in *this* entry's `env` block and (b) the explicit refs forwarded from `.scry.env` for the same MCP. No other refs resolve.
- `/mcps`: DELETE on a missing name returns 204.
- `/mcps`: POST without CSRF → 403. (Same for `/api/registry` PUT.)
- `/registry`: edit a person, click Save → PUT 200, row's dirty dot clears; on disk the registry sub-tree reflects the edit; comments above and below the `registry:` block survive byte-for-byte (golden test).
- `/registry`: a server 400 returns `{ error, errors: [{ path: ["people","alice","name"], message }] }`; the `alice` row renders the inline name error; the summary banner shows "Validation failed."
- `/registry`: GET on a no-config machine returns 412; route shows the onboarding-stub empty state. Same for `/mcps` GET.
- Two simultaneous PUT `/api/registry` requests serialize via the file lock; both succeed; second response reflects the merged final state.
- Browser back/forward across `/`, `/mcps`, `/registry` works; the Library sidebar's session list stays mounted (search state preserved across nav).
- `npm test` passes; `npm pack --dry-run` shows only `dist/` and `README.md`.

## Decision log

- **Two specs (E+F now, G+H later).** Config-editing surfaces share the most infrastructure (atomic write, schema, locking, error shape). Onboarding + preferences add their own concerns (env-presence probing, theme persistence) and are smaller; they ship in spec #2.
- **`react-router-dom` v6.** Hand-rolled hash routing was on the table; v6 is 14kB gz, supports browser back/forward and deep links, and is the idiomatic default. Sidebar-driven tab swap was rejected because losing URLs on browser back/forward is worse than the dep cost.
- **One write helper, one schema file.** Bypassing `writeConfig` for "just this one route" is the kind of thing that bit Plan C2 (server `+=` vs engine `\n`-join). Single path or it doesn't get written.
- **`proper-lockfile` for cross-process coordination.** The in-process latch from the first design pass would silently lose to `vim` or a second `scry serve`. A real file lock is cheap and correct.
- **412 for "config doesn't exist", not 409.** 409 is for true conflicts (name-exists). Using 412 uniformly on GET and PUT means the frontend never sees the "GET-empty-then-PUT-rejected" UX hole.
- **DELETE is idempotent (204 always).** Saves the frontend from optimistic-update branches.
- **Path-scoped error response shape locked in here.** `{ errors: [{ path: string[], message }] }` lets row components consume their own errors without re-mapping; without this, the registry editor can only show a generic banner.
- **Comments inside the registry block are deleted on save, not reformatted.** Honest UI copy. Users who care about comments hand-edit the YAML.
- **Env allowlist is per-entry, not regex-based.** The regex `^\$\{[A-Z][A-Z0-9_]*\}$` is shape validation, not a security boundary. The runtime resolver checks `${REF}` against the entry's own declared keys; this prevents a third-party MCP from silently slurping `${AWS_SECRET_ACCESS_KEY}` just because the regex permits uppercase.
- **`enabled` field added to `McpServerConfig`.** Supports the toggle column without deleting/restoring entries.
- **Test for SIGKILL by PID, not by return value.** A health-check that returns `ok: false` doesn't prove the child died; we PID-check.

## Dismissed reviewer points

- **GPT "close-while-pending in `StdioClientTransport`"** — small, real, but the SDK transport handles this in C3's existing test path. Defer to implementation; surface if it bites.
- **GPT "slash in safe-literal regex enables path traversal"** — the value is forwarded as a child env var, not used as a file path inside scry. Tightening the regex breaks legitimate hand-edit paths. Documented; not changed.
- **GPT "CSRF carry-through unverified"** — `csrfRequired` is mounted globally in `createServer` (verified in `src/server/index.ts`). Adding per-route CSRF-rejection tests defensively, but the structural concern doesn't apply.

---

End of design.
