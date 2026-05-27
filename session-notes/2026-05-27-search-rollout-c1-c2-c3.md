# 2026-05-27 — Plan C: search rollout (C1, C2, C3)

## Theme

Three-checkpoint delivery of a single spec: a Perplexity-shape browser experience on top of the engine pivot. Three PRs, manual verification at each step, multi-model spec review before each plan locked.

- **C1** (PR #8) — `POST /api/search` streaming route + browser search shell. Single-shot only.
- **C2** (PR #10) — In-page follow-up turns with SDK `resume`. Per-turn `[N]` scoping with visual turn boundaries.
- **C3** (PR #11) — SQLite-backed library sidebar. Sessions persist across reloads + restarts.

178 tests at the start of C1 → 199 tests at the end of C3. All on `main`.

## What got built

### C1 — Search route + UI single-shot (PR #8)

**Engine:**
- `src/engine/parse-sources.ts` — pure parser for Claude's trailing `Sources:` enumeration block. Anchors to last 2KB to avoid mid-prose false positives. Strips fenced code blocks. URL-sanitizes via scheme allowlist (`http`, `https` only — `javascript:`/`data:`/`file:` rejected).
- New `RunQueryEvent` variant `sources-finalized` yielded between final assistant text and `done` when parser succeeds. CLI ignores it (prose already has the enumeration); GUI swaps streaming arrival-order cards for canonical parsed cards.
- System-prompt nudge instructing Claude to emit `[N] <source-name>: <title> — <url-if-known>` lines after the answer.

**Server:**
- `POST /api/search` via Hono `streamSSE`. Body zod-validated. Emits typed `RunQueryEvent`s as `text/event-stream` `data:` blocks. Headers: `Cache-Control: no-cache` (Hono-set), `X-Accel-Buffering: no` (explicit), 15s keep-alive heartbeat as JSON `{ type: 'keepalive' }` (not raw `: comment` — frontend `JSON.parse`s every block).
- `AbortController` wired to `c.req.raw.signal` so client disconnect aborts the engine within ~1s.

**Frontend:**
- `SearchInput` — query box + fanout toggle + submit button.
- `SourceRail` + `SourceCard` — horizontal scroll of cards; sanitized URL anchors.
- `AnswerStream` — streaming text with `<sup>[N]</sup>` superscripts (hover/click handlers); optional strip of trailing `Sources:` block when `stripEnumeration` is true.
- `StatusPip` — inline tool-call chip; strips `mcp__<server>__` prefix.
- `Search.tsx` — state machine: `empty | submitting | streaming | done | error | aborted`.

**Issue #6 fold-in:** the legacy source-tracker rework. Lean on Claude's enumeration instead of normalizing per-MCP.

### C2 — In-page follow-up turns (PR #10)

- **Frontend state machine** refactored to `turns: TurnData[]` + `sessionId?: string` carried across turns. Submit after `done` appends a new turn that sends `sessionId` in the body.
- **`TurnBlock` component** — one turn = optional divider + `Turn N: <query>` label + own `SourceRail` + own `StatusPip`s + own `AnswerStream` + own `highlighted` state. Each turn's hover/click on `[N]` only affects its own rail.
- **DOM ID scoping** — `SourceCard` id changed from `source-card-{idx}` to `source-card-{turn}-{idx}` so click-to-scroll resolves correctly across turns.
- **Per-turn `[N]` scoping** — Claude restarts at `[1]` each turn (verified by observation, baked into design). Each turn renders its own `[1]`–`[N]`. No cross-turn renumbering.
- **Server**: body schema gains `sessionId?: string`; forwarded as `runQuery`'s `resume` option; SDK loads prior conversation from `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
- **Source-label constraint fix** (`fix(engine): constrain Sources block labels`) — during smoke-test, Claude fabricated `[1] Vault: Work/Decisions/...` despite scry's `allowedTools` blocking all filesystem reads. The label was hallucinated based on a path that appeared inside a real Slack/Confluence/Outlook tool result. Fix: system-prompt now enumerates configured `mcp_servers` names and forbids invented labels.

### C3 — Library sidebar + SQLite (PR #11)

**Storage:**
- `src/storage/sessions.ts` — `SessionsStore` class on `better-sqlite3` v12, WAL mode, `PRAGMA user_version = 1` set conditionally (only on fresh DB). Schema deliberately session-shaped (one row per session) with `turns_json` blob — multi-turn sessions fit naturally; flat per-turn columns would have multiplied rows.
- Composite `(updated_at, id) DESC` index + cursor for pagination — strict less-than on `updated_at` alone would skip same-millisecond rows (caught in plan review).
- `update`/`delete` return `info.changes` so routes can distinguish "applied" from "no row matched."

**Server:**
- `/api/sessions` routes (`GET` list with limit + before + beforeId, `GET /:id`, `PATCH /:id` rename, `DELETE /:id`). PATCH/DELETE rely on rows-affected count rather than a pre-flight `get()` (TOCTOU-free).
- `POST /api/search` accumulates turn data while streaming. On `done`: insert (first turn) or update + append (follow-up) the row. **`finalAnswer` captured from `done` event itself, not server-side concat of `assistant-text` deltas** — the engine joins multi-block answers with `\n`; a server `+=` would not.
- `boot.ts` constructs the store at `<scryConfigDir>/scry.db`, registers SIGINT/SIGTERM hooks for clean WAL shutdown.

**Frontend:**
- `LibrarySidebar` — always-visible left rail (collapsible to thin rail). Sessions bucketed by recency: Today / Yesterday / Last week / Older. "+ New search" button at top.
- `SessionRow` — title (truncated ≤60), `updatedAt` tooltip, hover-revealed `⋯` menu with Rename (in-place edit; double-fire guard via `committingRef` so Enter+blur doesn't double-PATCH) and Delete (with `window.confirm`). Errors surfaced via sidebar's error banner.
- `App.tsx` becomes a flex shell: `LibrarySidebar` left + `Search` right. App owns `activeSessionId` + `refreshKey`.
- `Search.tsx` accepts `activeSessionId`/`onSessionStarted`/`onSessionDone` props. `useEffect` deps for the session loader limited to `[activeSessionId]` (state mirrored via separate effect into `ownSessionIdRef`) — prevents the effect from re-firing on every streaming token.
- C2 reload notice removed (state is durable now).

## Multi-model spec review

Each plan reviewed by Claude (adversarial), GPT 5.x (downgraded to GPT-4.1 — proxy 503'd on GPT-5 + parameter-name mismatch), and Gemini (consistent truncation issue).

**Bugs caught BEFORE C3 execution:**
1. Composite `(updated_at, id)` cursor — strict less-than on `updated_at` alone could skip same-ms rows
2. `finalAnswer` divergence — engine joins with `\n`, server `+=` does not
3. `useEffect` deps in `Search.tsx` originally included `state` — would re-fire on every token; mirrored into ref instead
4. `SessionsStore.close()` not registered on SIGINT/SIGTERM — added
5. `PRAGMA user_version` would have been embedded in SCHEMA; future v2 migration would silently downgrade
6. Follow-up turn persistence test missing — added explicit assertion that follow-up appends to existing row

**Bugs caught AFTER C3 implementation, fixed in same PR:**
- Rename Enter+blur double-PATCH (`SessionRow` `committingRef` guard)
- `handleRename`/`handleDelete` swallowed errors silently — wrapped in try/catch with banner
- PATCH/DELETE TOCTOU (silent success on race) — drop pre-flight `get()`, inspect rows-affected instead

## Key Decisions

- **Per-turn `[N]` scoping over monotonic.** Spec already chose this. Claude restarts at `[1]` per turn naturally; forcing monotonic means fighting model behavior. Visual turn dividers + per-turn rails make the boundary obvious.
- **Insert-on-done, never on session-init.** Aborted/errored turns leave no orphan rows. The library only shows successful sessions. Sidebar refresh is one event late; acceptable.
- **`priorSources` dropped from C2 + C3 wire format.** Spec mentioned passing `priorSources` in body for engine context, but per-turn scoping makes each turn start at `[1]` and SDK `resume` already loads prior conversation from the session JSONL. Sending `priorSources` was redundant work. Documented as deviation in both plans.
- **`turns_json` blob over relational schema.** Multi-turn fits naturally as one row + array; querying by turn content isn't a use case.
- **JSON keepalive over raw SSE comment.** `data: : keepalive` would break the frontend's `JSON.parse`. `data: {"type":"keepalive"}` lets the consumer recognize and ignore.
- **Truth-over-comfort on review findings.** Two of GPT-4.1's "Critical" findings on PR #11 didn't hold up: it claimed an abort race between `sources-finalized` and `done`, but those yield in the same synchronous generator with no microtask gap. Called out the disagreement before applying any fixes.

## Files touched (high level)

**Created:** `src/engine/parse-sources.ts`, `src/storage/{sessions,types}.ts`, `src/server/routes/{search,sessions}.ts`, `web/src/components/{SourceCard,SourceRail,AnswerStream,StatusPip,SearchInput,TurnBlock,LibrarySidebar,SessionRow}.tsx`, `web/src/lib/{sanitize,sessions}.ts`, `web/src/routes/Search.tsx`. Tests for each.

**Modified:** `src/engine/{types,system-prompt,runQuery}.ts`, `src/cli/headless.ts`, `src/server/{index,boot,static}.ts`, `src/shared/types.ts`, `web/src/App.tsx`, existing server tests (now inject a temp `SessionsStore`).

## Open follow-ups

- **#7** — Engine fabricates parenthetical role/affiliation labels (e.g., `Katja Westphal (PMI)`). System-prompt nudge candidate; needs eval set before tuning.
- **#9** — Frontend renders raw markdown (`**bold**` shows as literal). Needs `react-markdown` with citation-preserving `components` overrides.

## Next Steps

1. Smoke-test C3 over a few real queries — confirm sidebar UX feels right with 5–10 sessions.
2. Tackle #9 (markdown rendering) — biggest visual quality gap.
3. Plans E–H (MCP / registry / onboarding / preferences UIs).
4. Plan I — E2E hardening + npm publish bump.

## Learnings

- **Spec → multi-model review → plan → multi-model review → execute** caught 6 bugs in C3 before any code was written. The plan review is cheaper than the execute review by an order of magnitude.
- **Subagent-driven execution + two-stage review (spec, then quality) per task** worked well. The implementer subagent caught 2 latent bugs in T1's plan-prescribed regex (the `[^)]+` issue in `parse-sources.ts`); the spec reviewer agent caught minor scope creep; the quality reviewer agent caught the missing `case 'sources-finalized'` in the CLI switch. None of these would have surfaced in single-pass execution.
- **The "deterministic fanout" pivot in B was the unlock for everything in C.** Without the SDK's session resume + cwd-locked JSONLs, C2 and C3 don't exist. The pivot looked like a refactor; it was actually a foundation move.
- **Author identity discipline matters.** Halfway through C1 noticed all commits were going out under the LeanIX work email (global git default). Fixed by flipping the global default to personal `aviralv@gmail.com` and adding repo-local overrides in the two LeanIX repos. Documented in `INTEGRATIONS.md`. Caught only because Avi noticed; would have shipped 12 mis-attributed commits otherwise.
- **GPT-5 is unreachable through the current proxy** — `max_tokens` vs `max_completion_tokens` parameter mismatch. Worked around by falling back to gpt-4.1 each time. Filed upstream issue separately.

## Tags
`#scry` `#search-route` `#sse` `#sqlite` `#wal` `#multi-turn` `#perplexity-shape` `#multi-model-review` `#subagent-driven`
