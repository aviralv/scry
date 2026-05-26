# scry — Search route + Library sidebar (Section 3 of v2 spec) — design

**Date:** 2026-05-25
**Status:** Approved by GPT-5 review + author
**Builds on:** v2 spec (`2026-05-22-scry-web-frontend-v2-design.md`), engine pivot (PR #4 merged)
**Closes:** issue #6 (source-tracker rework)

---

## Goal

Implement Section 3 of the v2 spec — the Perplexity-shape search experience — across **three checkpoints, three plans, three PRs**. Each checkpoint is independently shippable and gets manual verification before merge per `DEPLOYMENT.md`.

Folds in issue #6: the source-tracker rework needed for the GUI source rail to render real titles + URLs.

| Checkpoint | Surface | Approx tasks |
|---|---|---|
| **C1** | Search route + UI (single-shot) + #6 source-tracker rework | ~8 |
| **C2** | + In-page follow-up (resume by sessionId, no persistence) | ~6 |
| **C3** | + Library sidebar + SQLite persistence | ~6 |

## Non-goals

Same as v2 spec: no multi-user, no remote deployment, no auth, no mobile, no Windows. Plus Plan-C-specific:

- E2E Playwright tests (deferred to a later plan)
- "Related questions" chips below the answer (already deferred in v2)
- Multi-tab live sidebar sync — single-tab assumption acceptable for v1
- Orphan SDK JSONL cleanup on session delete — documented as a known limitation; v2 preference adds a sweep

---

## Architecture

```
Browser                           Hono server (Plan A)               Engine (Plan B)
─────────                         ──────────────────────             ──────────────
SearchPane                        POST /api/search                   runQuery()
  ├── SearchInput                   ├── Origin/CSRF middleware         ├── Agent SDK query()
  ├── SourceRail                    ├── zod body schema                ├── SourceTracker
  ├── AnswerStream                  ├── AbortController on disconnect  └── parse-sources (NEW)
  └── StatusPip                     └── streamSSE response
       │                                 │
       └── lib/stream.ts ──────fetch streaming (POST)──┘
       │                                 │
       │                                 │  (C3 only)
       │                                 ▼
       │                            src/storage/sessions.ts
       │                              SessionsStore on better-sqlite3
       │                                 │
       └── (C3 only)                     │
       LibrarySidebar ◀───── GET /api/sessions
                       PATCH /api/sessions/:id
                       DELETE /api/sessions/:id
```

**Single engine, three transports** (CLI/CLI-fanout/HTTP) all call the same `runQuery`. The HTTP route is a thin streaming wrapper.

**Browser stream consumer is `web/src/lib/stream.ts`** (already in Plan A foundation) — it parses `text/event-stream`-shaped responses via `fetch()` + `body.getReader()`. **Not** `EventSource` (which only supports GET and can't carry CSRF headers).

**Streaming response headers** (from C1 onward, on `POST /api/search`):

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no            // tells nginx-style proxies to not buffer
```

Server emits keep-alive comments (`: keepalive\n\n`) every 15s when no event has fired in that window — prevents proxy timeouts and tells the client the stream is still live.

---

## Issue #6 — Source-tracker rework (lands in C1)

The current `source-tracker` records every `tool_result` and assigns `[N]` in arrival order. Claude's inline `[N]` citations don't align with this numbering — it picks its own indices based on the sources it considers important. Reworking:

### Two-phase tracking per turn

**Phase 1 (during streaming):** as today. `tool_result` blocks get parsed, recorded as `SourceCard`s with `index = arrival order`, fields populated where possible from the markdown content. These power "fetching from slack..." progress cards in the GUI rail. **The CLI ignores these card events.** They serve only as live progress for the GUI.

**Phase 2 (on `done`, before yielding):** parse Claude's final-answer enumeration to produce the **canonical** source list. Replace the in-memory list. Emit a new event:

```typescript
{ type: 'sources-finalized'; sources: SourceCard[] }
```

…before the `done` event. The GUI swaps the streaming "fetching..." cards for the canonical structured cards; the CLI ignores it (Claude's prose already includes the enumeration).

### Parser (`src/engine/parse-sources.ts`)

Pure function. Input: `finalAnswer: string`. Output: `SourceCard[]` (possibly empty).

**Strategy:**
1. Find a heading near the end of the text matching `/^Sources?:\s*$/im` OR a contiguous run of lines starting with `[N]` at the tail. **Anchor to the last 2KB of the answer** to avoid matching mid-prose `[N]:` patterns or fenced code blocks containing the word "Sources".
2. Parse each line. Recognize three shapes:
   - `[N] <source>: [<title>](<url>)` — markdown link
   - `[N] <source>: <title> (<url>)` — bare URL in parens
   - `[N] <source>: <title>` — no URL
3. **URL sanitization**: only `http://` and `https://` schemes pass. Reject `javascript:`, `data:`, `file:`, host-relative, and unparseable URLs. Cards rendering links use `target="_blank" rel="noreferrer noopener"`.
4. Build `SourceCard[]` ordered by the parsed `[N]` (preserve, don't renumber). If indices aren't unique 1..k, drop to fallback.
5. **Fallback:** if parser returns 0 sources, emit nothing (no `sources-finalized`). The GUI renders the streaming arrival-order cards as final, AND the answer keeps the trailing `Sources:` block intact (don't strip on failure — see GUI rules below).

### System-prompt nudge

Existing prompt says "cite as [N]"; doesn't ask for the trailing enumeration. Add to output rules in `src/engine/system-prompt.ts`:

```
- After your answer, emit a "Sources:" heading on its own line, then list each cited
  source on its own line formatted: `[N] <source-name>: <title> — <url-if-known>`.
  Use the same [N] indices you used inline. Use markdown link syntax for URLs.
```

This makes Claude reliably produce parseable output. The fallback handles the cases where it doesn't.

### Tests (`tests/engine/parse-sources.test.ts`)

Fixture-based; ~10 cases:

1. Basic shape (real data from live testing): mixed Confluence + Slack + Jira lines
2. Markdown-link variants: `[N] X: [title](url)`
3. Plain text (no URL): `[N] X: title`
4. URL in parens: `[N] X: title (url)`
5. Comma-separated list inside one entry (e.g., Jira ticket list): `[N] X: A, B, C`
6. Missing Sources heading — items are at the tail with `[N]` prefix only
7. **Negative**: `Sources:` appears in a fenced code block — parser must NOT pick it up
8. **Negative**: `[1]: something` inline mid-prose — parser must NOT pick it up (anchored to tail)
9. **Negative**: malicious URL (`javascript:alert(1)`) — sanitized out (URL absent in card)
10. **Empty input** or no enumeration — returns `[]`; caller handles fallback

### Engine event-ordering invariant

`sources-finalized` MUST be emitted **after** the last assistant content block has been received and **before** `done`. Test fixture covers this:

```
session-init → assistant.text → tool_use → tool_result → assistant.text(final) → sources-finalized → done
```

NOT this (broken):

```
session-init → assistant.text → sources-finalized → assistant.text(final) → done
```

The engine accumulates `finalAnswer` until the for-await loop exits, then runs the parser, then yields `sources-finalized`, then yields `done`. Already correct in `runQuery`'s structure (yield-after-loop pattern); just needs an explicit test.

---

## Plan C1 — Search route + UI (single-shot)

### Server

**`src/server/routes/search.ts`** — single new route mounted at `POST /api/search`:

```ts
POST /api/search
  Headers:
    X-Scry-Csrf: <token>
    Content-Type: application/json
  Body (zod-validated):
    { query: string, fanoutMode?: boolean }
  Response:
    Content-Type: text/event-stream
    Cache-Control: no-cache
    Connection: keep-alive
    X-Accel-Buffering: no
  Body: SSE-shaped stream, one `data: <JSON>\n\n` block per RunQueryEvent
```

Server flow:
1. Validate body shape (zod schema). Reject malformed with structured 400.
2. Resolve config dir (XDG fallback chain — same logic the CLI uses; lift into `src/config/loader.ts` if needed).
3. Set up `AbortController` wired to the request's abort signal (`req.raw.signal`).
4. Call `runQuery({ prompt, config, scryConfigDir, signal, fanoutMode })`.
5. For each event, write `data: ${JSON.stringify(event)}\n\n` to the stream via Hono's `streamSSE` helper.
6. Keep-alive comment every 15s if no event has fired in that window.
7. On client disconnect → AbortController fires → engine terminates → MCP child processes shut down within ~1s.

Mounted in `createServer` after the existing CSRF + Origin middleware.

### Frontend

`web/src/App.tsx` becomes a router shell (currently the placeholder palette). New route at `/`:

**`web/src/routes/Search.tsx`** — owns state, wires submit → fetch → events → render.

State machine:
```
empty → submitting → streaming → done | error | aborted
```

Components added under `web/src/components/`:

| Path | Responsibility |
|---|---|
| `SearchInput.tsx` | Query box + fanout toggle + submit. Disabled while streaming. |
| `SourceRail.tsx` | Horizontal row of source cards. Shows streaming cards during phase 1 + replaces with canonical cards on `sources-finalized`. |
| `SourceCard.tsx` | One card. Shows source, title, URL (sanitized), optional author/timestamp. Has a stable `id` for hover linking. |
| `AnswerStream.tsx` | Streaming text panel. Converts `[N]` markers into `<sup>N</sup>` tags with `data-cite={N}`. Strips trailing `Sources:` block ONLY when parser succeeded (signaled by `sources-finalized` event with non-empty array). |
| `StatusPip.tsx` | Inline chip for `tool-call` events ("→ slack_search"); auto-collapses into the matching source card on `tool-result`. |

### Citation behavior

Inline `[N]` markers are rendered as `<sup>` superscripts wired to the rail:
- **Hover**: highlight matching card via CSS class
- **Click**: scroll the card into view + open URL in new tab (if URL present, after sanitization)

### State machine details

| State | UI |
|---|---|
| `empty` | Input centered, no panels |
| `submitting` | Input disabled, "Connecting..." pip |
| `streaming` | Input disabled (Plan C1 — no follow-up); rail + answer grow as events arrive |
| `done` | Rail + answer frozen; "New search" button replaces input |
| `error` | Red banner + retry button. Source cards captured pre-error remain visible. |
| `aborted` | Same as done but with "Stopped" badge |

### Rendering rule for the trailing `Sources:` block

The block is stripped from the rendered answer **only if**:
- `sources-finalized` event arrived with a non-empty array
- AND the parser successfully extracted ≥1 source

If parser returned empty (event omitted or empty), the block stays in the rendered answer. This way users always see citations — either via the structural rail OR via Claude's prose, never neither.

### Acceptance — C1

- `scry serve`; navigate to `http://127.0.0.1:6678` → search input visible
- Submit a query → status pips appear in browser; rail builds with streaming cards; answer streams; on `done`, rail swaps to canonical structured cards; final answer renders without the trailing `Sources:` block (Claude's prose duplicate is hidden because the rail shows it structurally)
- Inline `[N]` markers hover-link to source cards (highlight) and click-link to sanitized URL when present
- Close browser tab mid-stream → MCP child processes terminate within 1s (verify with `ps`)
- Cross-origin POST rejected with 403; missing CSRF rejected with 403
- A query whose answer doesn't include a `Sources:` block (or where parser fails) → answer renders unchanged (nothing stripped); rail shows streaming arrival-order cards as final
- A query where Claude includes a malicious URL (e.g. `javascript:alert(1)`) → card renders without the link
- CLI `scry "<query>"` continues to work unchanged (still prints Claude's prose including the trailing block)
- `npm test` passes; new tests for parse-sources (10 fixtures) + search route (happy + abort + reject paths) + components

---

## Plan C2 — In-page follow-up (no persistence)

### Frontend

`Search.tsx` keeps `sessionId` in component state after `done`. After `done`:
- Input box returns (instead of just `New search`-only)
- Submit re-uses the prior `sessionId`
- A separate `New search` button clears state + drops `sessionId`

`Stop` button visible during streaming.

### Server

**`POST /api/search` body extends to:**

```ts
{ query: string, sessionId?: string, fanoutMode?: boolean, priorSources?: SourceCard[] }
```

When `sessionId` is present:
- Pass `resume: sessionId` + `priorSources` into `runQuery`
- The Agent SDK loads the session's prior conversation from its JSONL (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`)

**`priorSources` lives in client memory** through C2; client sends it back per request. Capped at the last 50 entries to bound body size. Plan C3 moves `priorSources` to server-side SQLite lookup by `sessionId`.

### Per-turn `[N]` scoping

Claude often restarts at `[1]` per turn rather than continuing. C2 treats each turn's `[N]` as scoped to that turn:
- Each turn's `sources-finalized` produces its own list
- The rail accumulates by turn — older cards keep their original turn-N labels visually (e.g. "T1.1", "T1.2" in turn 1, "T2.1", "T2.2" in turn 2) OR a horizontal divider between turns + each turn's `[1]`-`[N]` shown locally
- Inline `[N]` superscripts within a turn's answer link only to that turn's cards
- This is simpler and matches how Claude actually behaves; avoids miss-mapping a hover to the wrong source

### Reload-loses-state notice

During C2 follow-up turns, a small `[i] reload loses state — Plan C3 adds persistence` notice appears at the bottom of the search pane. Removed when C3 lands.

### Acceptance — C2

- After C1's `done`, input remains usable; submit triggers a follow-up
- Network panel shows `sessionId` in the request body
- Server logs show `resume: <id>` passed to `runQuery`
- New `tool-call` / `tool-result` events stream into the rail with **separated turn boundaries** (visual divider between turn 1 and turn 2)
- New turn's `[N]` superscripts scope only to that turn's cards
- `New search` button clears everything; submitting starts a fresh session
- Hard reload of the browser → state lost, notice was visible during follow-up
- `priorSources` array in body never exceeds 50 entries (oldest dropped)

---

## Plan C3 — Library sidebar + SQLite persistence

### Storage layer

**`src/storage/sessions.ts`** — new file. `SessionsStore` class on `better-sqlite3`.

```ts
interface SessionRow {
  id: string;
  cwd: string;
  title: string;
  query: string;
  summary: string;
  finalAnswer: string;
  sourcesJson: string;
  createdAt: number;
  updatedAt: number;
}

class SessionsStore {
  insert(s: InsertSession): void;
  get(id: string): SessionRow | null;
  list(opts?: { limit?: number; before?: number }): SessionRow[];  // pagination
  update(id: string, patch: UpdateSession): void;
  delete(id: string): void;
  close(): void;
}
```

Schema:

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  cwd           TEXT NOT NULL,
  title         TEXT NOT NULL,
  query         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  final_answer  TEXT NOT NULL DEFAULT '',
  sources_json  TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
```

WAL mode at boot. Database file lives at `<scryConfigDir>/scry.db`.

### Insert timing — orphan-safe

**Insert on `done`, not on `session-init`.** Originally the design had optimistic insert at `session-init` for instant sidebar feedback, but that leaves orphan empty rows on abort/error. C3 inserts only when there's a finalized session (i.e., on `done` event from `runQuery`). Sidebar updates after the first `done` of a new session. The slight delay before the new entry appears is acceptable.

Follow-up turns of an existing session call `update()` instead of `insert()`.

### Server routes added

```
GET    /api/sessions?limit=100&before=<ts>   → SessionRow[] (pagination)
GET    /api/sessions/:id                     → SessionRow
PATCH  /api/sessions/:id                     → { title? } — rename; updates `updated_at`
DELETE /api/sessions/:id                     → remove from index (SDK JSONL stays on disk)
```

`POST /api/search` updates:
- On `done`: insert (new session) or update (existing) the row in `sessions`
- `priorSources` moves from request body to **server-side lookup** by `sessionId` — reads `sources_json` from the row, passes to `runQuery`
- Body schema reverts to `{ query, sessionId?, fanoutMode? }` (no more `priorSources`)

### Frontend

`LibrarySidebar` component, always visible left, collapsible to a thin rail:

| Path | Responsibility |
|---|---|
| `web/src/components/LibrarySidebar.tsx` | Always-visible left panel; collapsible |
| `web/src/components/SessionRow.tsx` | One row: title (truncated to ~40 chars), timestamp tooltip, "..." menu (Rename / Delete) |

Behavior:
- Sessions grouped by relative time bucket: Today / Yesterday / Last week / Older
- Click row → `GET /api/sessions/:id` → renders saved query + answer + sources + enables follow-up tagged with that `sessionId`
- "..." menu: Rename triggers in-place edit + `PATCH`; Delete confirms + `DELETE`
- "New search" button at top of sidebar → clears search pane, drops `sessionId`
- Library reads from SQLite ONLY — never the SDK's JSONL. The SDK consumes its own JSONL on `resume` calls.
- Layout becomes Perplexity-shape: sidebar left, search pane right.

### Acceptance — C3

- After any `done`, a session row appears in the sidebar with the query as title
- Hard reload of browser → sidebar still shows past sessions
- Click a sidebar row → loads saved query + answer + sources from SQLite; follow-up resumes via SDK
- `scry serve` exit + restart → past sessions still in sidebar; clicking one loads it; follow-up still resumes via SDK JSONL (cwd-locked, so JSONL paths stable)
- Rename via "..." menu persists; reload preserves the new title
- Delete removes the row; SDK JSONL remains on disk (documented limitation)
- Aborted/errored sessions do NOT create orphan rows (insert-on-done semantics)
- `GET /api/sessions` returns at most 100 rows; `before` cursor paginates

---

## Risks and mitigations

| Risk | Mitigation | Plan |
|---|---|---|
| Claude doesn't reliably emit the `Sources:` block → parser empty | System prompt nudge + fallback (don't strip block from answer; show streaming list) | C1 |
| Strip-enumeration regex eats legitimate prose with `[N]:` patterns or fenced `Sources:` | Anchor to last 2KB; require a `Sources?:` heading-like line; only strip on parser success | C1 |
| Malicious URL in citation → XSS | Scheme allowlist (`http`/`https`); `rel="noreferrer noopener"`; reject and render plain text otherwise | C1 |
| Fetch streaming stalls behind a corporate proxy | Server emits keep-alive every 15s; sets `X-Accel-Buffering: no`; client treats `error` as recoverable | C1 |
| Tab-close mid-stream leaves zombie MCP processes | Acceptance test: `ps` shows no mcp children 1s after disconnect | C1 |
| User starts follow-up while prior turn is streaming | Disable input during streaming (state machine) | C2 |
| `priorSources` body bloat | Cap at 50 entries; client truncates oldest | C2 |
| Cross-turn `[N]` mis-mapping | Per-turn scoping with visual turn-divider; superscripts only link to same-turn cards | C2 |
| SQLite orphan rows on aborted sessions | Insert on `done`, not on `session-init` | C3 |
| SQLite write blocks streaming hot path | Writes only on `done` (not per-token); WAL mode; rows are small | C3 |
| Multi-tab sidebar staleness | Single-tab assumption documented; multi-tab live sync deferred | C3 |
| Session delete leaves orphan SDK JSONL | Documented; v2 adds a sweep | C3 |

---

## Decision log (over v2 spec)

- **Three-PR delivery for one spec.** Manual verification at each checkpoint per `DEPLOYMENT.md`.
- **Browser stream consumer is `web/src/lib/stream.ts`** (already in Plan A) — fetch + getReader + parse `data:` blocks. NOT `EventSource`.
- **`sources-finalized` is a new engine event** emitted between the last assistant content and `done`. CLI ignores it; GUI uses it to swap streaming cards for canonical and to decide whether to strip the trailing `Sources:` block from the rendered answer.
- **Don't strip `Sources:` block on parser failure.** GUI keeps the original answer intact in that case.
- **URL sanitization on all citations.** `http`/`https` only; `javascript:`/`data:`/`file:` rejected.
- **Per-turn `[N]` scoping in C2** — Claude often restarts at `[1]` per turn; assuming continuity is wrong. Each turn has its own `[N]` namespace; rail shows turn boundaries.
- **`priorSources` in client memory in C2 → server-side in C3** — avoids storage dependency at the C2 milestone. Cap at 50 entries during C2.
- **SQLite insert on `done`, not on `session-init`** — orphan-safe. Sidebar update is one event late; acceptable.
- **`GET /api/sessions` paginated** — `limit 100 + before <ts>` cursor.
- **Streaming response headers**: `X-Accel-Buffering: no`, `Cache-Control: no-cache`, `Connection: keep-alive`. 15s keep-alive comments.

---

## Out of scope (v2 spec deferrals not in C1/C2/C3)

- MCP manager UI — Plan E
- Registry editor UI — Plan F
- Onboarding wizard UI — Plan G
- Preferences pane + theme toggle — Plan H
- E2E Playwright suite + npm publish hardening — Plan I
- Orphan SDK JSONL cleanup on session delete
- Multi-tab live sidebar sync
