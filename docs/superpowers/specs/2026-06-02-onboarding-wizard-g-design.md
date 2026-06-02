# scry Plan G — onboarding wizard — design spec

**Date:** 2026-06-02
**Status:** Draft, pending user approval
**Builds on:** Plans E (MCP manager) + F (Registry editor) merged on `main`
**Reviewed by:** Claude (author); pending GPT-5 + Gemini 2.5 Pro adversarial pass.

---

## Goal

A single browser surface that takes a brand-new scry user from "first launch" to "configured and searching" without YAML editing. Closes the manual-paste workflow caught during Plan E smoke. Reuses Plan E's `writeConfig` + zod schemas + `mcps` route + `McpAddModal` + Plan F's working-copy patterns; adds three new endpoints and one new route.

`scry init` (the CLI wizard) stays as-is for users who prefer terminal flow. `/onboarding` is the equivalent web surface; not a replacement.

## Non-goals

- Sharing scry between multiple users (single-user spec; lock semantics are last-write-wins beyond the file lock).
- MCP marketplace, OAuth-style MCP auth, per-tool overrides.
- Persisting wizard *progress*: the disk state IS the progress. No session storage, no draft mode.
- Discovery from `~/.claude.json` or arbitrary PATH-walking within the wizard. Step 2 does call `GET /api/mcps/discover` for a simple "is the bundled command on PATH?" check (used to render the install hint), but it does NOT ingest existing entries from Claude's config — that's `scry init`'s job and stays in the terminal flow.
- Backwards compatibility for configs without an `onboarding` block. Absent block → treated as `completed: false` for new users; existing users with hand-rolled configs get a one-time auto-write of `onboarding.completed: true` on the first `GET /api/onboarding` IF `llm` is present AND `mcps_servers` is non-empty (so they don't get auto-redirected into a wizard they don't need).
- Multi-language UI; English copy only.

## Architecture

### Trigger & redirect

- New `web/src/components/RequireOnboarding.tsx` wraps `/`, `/mcps`, `/registry` routes in `App.tsx`.
- On mount, calls `GET /api/onboarding` once. If `completed: false` → renders `<Navigate to="/onboarding" />`. Else renders children.
- 412 from any of the wrapped routes also redirects (handled inside the route's existing 412 path — replaces "Run scry through onboarding first" copy with auto-navigation).
- Navigating directly to `/onboarding` is allowed regardless of completion state (re-entry path).

### Three steps, per-step writes

| Step | Purpose | Writes on Continue |
|---|---|---|
| 1 — LLM | base_url + auth + model + real test call | `llm:` block + (optionally) `.scry.env` |
| 2 — MCPs | Pick bundled MCPs and/or add custom; per-MCP env input + health-check | `mcp_servers:` per entry + `.scry.env` |
| 3 — Confirm | Read-only summary + finalize | `onboarding.completed: true` |

Refresh-safe and re-entrant. Disk state IS wizard state. Partial states are valid scry configs (LLM-only configs work; MCP-only configs don't, but the wizard surfaces this via a banner on `/`).

### Layout

Two-pane: 240px left rail, full-width content right of it.

- **Rail**: all 3 steps stacked vertically with status circle (`✓` done, accent-filled active, plain todo) and per-step live summary. Summaries update from client state during input (e.g., as the user types a model name in Step 1, the rail summary reflects the in-flight value, not just the disk-persisted one); after Continue, the summary matches the persisted state.
- **Pane**: active step's full-width content. Single-column stack for MCP cards (not 2×2 grid — cards expand inline when picked, full width breathes).
- Rail steps are click-targets — jump forward or back at any time.
- URL sync: `/onboarding?step=1|2|3` is bookmarkable and refresh-safe.

## Step 1 — LLM

### Inputs (top to bottom)

1. **Base URL** — text input. Default `https://api.anthropic.com`. On change, the auth field below adapts.
2. **Auth token** — adaptive input:
   - **If base_url matches `https://api.anthropic.com`**: text input prefilled with `${ANTHROPIC_API_KEY}` if `process.env.ANTHROPIC_API_KEY` is set on the server (detected via `GET /api/onboarding`'s response — the field returns `hasAuth: true` plus a separate `detectedRefs: ['ANTHROPIC_API_KEY']` list for prefill purposes only, never the token value). Helper text: "Detected from environment — leave as-is, or paste a different value."
   - **If base_url is non-default** (anything else): a checkbox above the input — "[ ] No auth required (proxy handles it)" — default-checked when base_url contains `localhost` or `127.0.0.1`. Unchecked → password input visible. Checked → input disabled and grayed.
3. **Model** — text input. Default `claude-haiku-4-5-20251001`.

### Continue → Test → Write

1. Client calls `POST /api/llm/test` with the proposed `{ base_url, auth_token?, model }`.
2. Server runs a 1-token completion against the configured endpoint (single fixed prompt: "ok"). Timeout 5s. Returns `{ ok: true, model: <echoed> }` or `{ ok: false, error: <human-readable> }`.
3. On `ok: true`: client calls `PUT /api/llm` with the same body. Server validates with `LlmConfigSchema`, writes `llm:` block via `writeConfig`. If `auth_token` is present and **does NOT match** `^\$\{[A-Z][A-Z0-9_]*\}$`, also writes `SCRY_LLM_TOKEN=<value>` to `.scry.env` (overwriting any previous value silently — the wizard owns this key) and rewrites the auth_token in config to `${SCRY_LLM_TOKEN}`. Returns 200; client advances to Step 2.
4. On `ok: false`: red banner under the form. Two affordances: "Retry" (re-runs the test) and "Skip — searches will fail until fixed" (POST `/api/onboarding/skip` with `{ step: 'llm' }` → writes `onboarding.llm_skipped: true`, advances to Step 2).

### Validation rules

- `base_url` must be a valid URL (`z.string().url()`).
- `model` must be ≥ 1 char.
- `auth_token` is optional; if present, must match `${REF}` shape OR a "safe literal" (alnum + `-_=:./@+`) — same rules as Plan E env values, encoded in the existing schema regex.

## Step 2 — MCPs

### On mount

Client calls `GET /api/mcps/discover` → `{ bundled: BundledServer[], pathInstalled: string[] }`. The `bundled` array comes from `BUNDLED_SERVERS` in `src/config/bundled-servers.ts`. The `pathInstalled` array comes from `scanPathForServers()` (existing). Used to render PATH-status on each card.

Client also re-reads `GET /api/onboarding` so that if any MCPs are already configured (re-entry case), they appear pre-picked with their existing env values prefilled.

### UI

Single-column vertical stack of cards. Each bundled MCP renders one card showing:

- Checkbox + name + description (top row)
- PATH status to the right: `✓ <command> on PATH` (green) or `✗ <command> not found` (red)
- If picked: env block expands inline — one input per entry in `bundled.envVars[]`, label = the var name (`SLACK_TOKEN`, `MS365_CLIENT_ID`, etc.), input prefilled if the same key already exists in `.scry.env` (read via `GET /api/onboarding`'s `detectedEnvKeys` field).
- If not on PATH and not picked: a boxed monospace install hint underneath: `uv tool install git+<githubUrl>`. Picking the card surfaces a warning that health-check will fail until installation completes.

Below the bundled cards: a dashed "+ Add custom MCP" tile. Clicking opens the existing `McpAddModal` from Plan E (no new component). On modal save, the custom MCP is added to the wizard's working list — it shows up as another picked card above with its env block expanded.

### Test & Continue

1. For each picked card, client calls `POST /api/mcps` (existing endpoint from Plan E) with `{ name, command, args?, env: { VAR_NAME: "${VAR_NAME}" } }` — the env block is constructed formulaically from `envVars[]`. Plan E's POST already runs `healthCheck` before write; failures bubble up as 422.
2. For each `${VAR_NAME}` entry, the wizard ALSO calls a new `PUT /api/onboarding/env` with `{ keys: { VAR_NAME: <user-entered-value> } }` — server merges into `.scry.env` via `writeDotEnv`.
3. Order: `.scry.env` write FIRST, then `POST /api/mcps` (so health-check spawns can resolve `${REF}` against the just-written `.scry.env`).
4. Each card runs in parallel via `Promise.allSettled`. Per-card spinner during.

### Failure handling

- Per-card 422 (health-check failed) → inline red banner on that card with `Retry` and `Drop & continue`. `Drop & continue` calls `DELETE /api/mcps/<name>` (idempotent) and removes from picked list.
- All-cards-failed → wizard stays on Step 2 with skip option re-emphasized.
- ≥1 card succeeded → "Continue" advances to Step 3.

### Skip

"I'll configure MCPs later — search will be unavailable" link. Confirm dialog: "Search will return 'no sources configured' until you add an MCP. Continue?" → `POST /api/onboarding/skip` with `{ step: 'mcps' }` → writes `onboarding.mcps_skipped: true`, advances to Step 3.

## Step 3 — Confirm & finalize

Read-only summary with sections:

- **LLM**: model name + base_url + "Auth: ✓ configured" / "Auth: ⚠ skipped". Edit button → rail click to Step 1.
- **MCPs**: list of configured entries with health status icons. Edit button → rail click to Step 2.
- **Final note**: "Click finalize to mark setup complete and start searching." Plus, if either skip flag is set: "⚠ Search will be limited until [LLM/MCP] is configured."

`Finalize & start searching` button → `POST /api/onboarding/complete` → server writes `onboarding.completed: true` → client navigates to `/`.

Re-entry (direct nav to `/onboarding` after completion): lands on Step 3, every step on the rail clickable. Clicking Step 1 or Step 2 expands it for editing; saving lands back on Step 3 (NOT auto-redirected to `/`). On Step 1 re-edit, the LLM test ALWAYS re-runs on Continue (the user might be changing the token); writes only happen if the test passes (or skip is taken). On Step 2 re-edit, individual MCP edits flow through the existing `PATCH /api/mcps/<name>` from Plan E, which also re-runs health-check.

## Server architecture

### New routes

```
GET    /api/onboarding              → 200 { llm, mcps, onboarding, detectedRefs, detectedEnvKeys }
                                       | 412 config-required
POST   /api/onboarding/complete     → 200 { completed: true } | 412
POST   /api/onboarding/skip         body: { step: 'llm' | 'mcps' }
                                     → 200 { onboarding } | 400 | 412
PUT    /api/onboarding/env          body: { keys: Record<string, string> }
                                     → 200 { keysWritten: string[] } | 400 | 412
PUT    /api/llm                     body: { base_url, auth_token?, model }
                                     → 200 { llm } | 400 | 412
POST   /api/llm/test                body: { base_url, auth_token?, model }
                                     → 200 { ok: true } | 200 { ok: false, error } | 400
GET    /api/mcps/discover           → 200 { bundled, pathInstalled } | 412
```

`GET /api/onboarding` returns an aggregated view; it does NOT compute the active step (per Q5 / Q-arch decision: server stays dumb, client derives).

```ts
type OnboardingState = {
  llm: { base_url: string; model: string; hasAuth: boolean } | null;
  mcps: McpServerEntry[];                  // same shape as GET /api/mcps
  onboarding: {
    completed: boolean;
    llm_skipped?: boolean;
    mcps_skipped?: boolean;
  };
  detectedRefs: string[];                  // env var names present in process.env that match an MCP env requirement OR `ANTHROPIC_API_KEY`
  detectedEnvKeys: string[];               // env var names present in `.scry.env` (no values)
};
```

### Schema additions in `src/config/schema.ts`

```ts
const URL_RE = /^https?:\/\/.+/;

export const LlmConfigSchema = z.object({
  base_url: z.string().regex(URL_RE),
  auth_token: z.string().regex(ENV_VALUE_RE).optional(),
  model: z.string().min(1),
});

export const OnboardingSchema = z.object({
  completed: z.boolean().default(false),
  llm_skipped: z.boolean().optional(),
  mcps_skipped: z.boolean().optional(),
});

// ScryConfig additions:
//   onboarding?: z.infer<typeof OnboardingSchema>
//   llm: z.infer<typeof LlmConfigSchema>     (already present, now schema-typed)
```

### `.scry.env` write helper

New `src/config/dotenv-write.ts`:

```ts
export function writeDotEnv(path: string, kv: Record<string, string>): Promise<void>
```

- Acquires `proper-lockfile` on `<path>.lock`.
- If file exists: reads, parses into `Map<string, string>` preserving order and surrounding comments. Updates existing keys, appends new ones. Comments adjacent to a key (immediately preceding or trailing on the same line) move with the key.
- If file does not exist: creates with `KEY=value` lines, no comments.
- Values containing `\n`, `"`, or `'` get double-quoted with backslash escaping. Values matching `^[A-Za-z0-9._/=:@+-]+$` are written bare.
- Atomic write: tmp + fsync + rename.

Tests cover: idempotent merge, comment preservation for unchanged keys, value quoting, concurrent writes serialize via lock.

### LLM test implementation

New `src/server/llm-test.ts`:

```ts
export async function runLlmTest(opts: {
  base_url: string;
  model: string;
  auth_token?: string;
}): Promise<{ ok: true } | { ok: false, error: string }>
```

- Builds an Anthropic-compatible POST: body `{ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }`. Endpoint: `<base_url>/v1/messages`.
- Headers: `content-type: application/json`, `anthropic-version: 2023-06-01`, plus `x-api-key: <auth_token>` if present (resolves `${REF}` against `process.env` first; if missing in `process.env`, returns `{ ok: false, error: 'env var X not set' }`).
- Timeout 5s via `AbortController`.
- HTTP 200 → `{ ok: true }`. HTTP 4xx/5xx → `{ ok: false, error: <status>: <body slice up to 200 chars> }`. Network error → `{ ok: false, error: <message> }`.
- Does NOT depend on the actual Anthropic SDK — just `fetch`. Custom proxies that present an Anthropic-compatible API work transparently.

## Client architecture

### New files

```
web/src/
├── routes/
│   └── Onboarding.tsx                    NEW — rail + active-step pane + URL sync
├── components/
│   ├── RequireOnboarding.tsx             NEW — redirect wrapper for /, /mcps, /registry
│   └── onboarding/
│       ├── OnboardingRail.tsx            NEW — left rail with summaries
│       ├── OnboardingLlm.tsx             NEW — Step 1 form
│       ├── OnboardingMcps.tsx            NEW — Step 2 list + per-card env
│       ├── OnboardingConfirm.tsx         NEW — Step 3 summary + finalize
│       └── McpCard.tsx                   NEW — single bundled-MCP card with picked/env-expand state
└── lib/
    ├── onboarding.ts                     NEW — typed client (state, complete, skip, env)
    ├── llm.ts                            NEW — typed client (put, test)
    └── mcps-discover.ts                  NEW — typed client
```

### Modified files

- `App.tsx` — adds `<Route path="/onboarding" element={<Onboarding />} />`. Wraps non-onboarding routes in `<RequireOnboarding>`.
- `LibrarySidebar.tsx` — adds conditional "Onboarding" NavLink (rendered iff `!completed`). Reads onboarding state once on mount; refreshes on `refreshKey` change so finalize hides it.

### State derivation (client side)

```ts
function deriveStep(state: OnboardingState): 1 | 2 | 3 {
  if (state.onboarding.completed) return 3;
  if (state.llm == null && !state.onboarding.llm_skipped) return 1;
  if (state.mcps.length === 0 && !state.onboarding.mcps_skipped) return 2;
  return 3;
}
```

URL `?step=N` overrides derivation IF the user manually clicks a rail step (so they can click back to Step 1 even after Step 1 is complete).

### Banner on `/`

Search route reads `GET /api/onboarding` once on mount. If `mcps_skipped: true` AND `mcps.length === 0` → renders top banner: "No MCPs configured — search has no sources. [Configure now →]". If `llm_skipped: true` AND `llm == null` → "LLM not configured — searches will fail until you complete LLM setup. [Configure now →]". Banners hide automatically once underlying state is satisfied (the derived condition becomes false).

## Concurrency & file locks

All `.scry.env` and `scry.config.yaml` writes flow through `proper-lockfile` (Plan E infra). Two parallel browser tabs in the wizard serialize writes. Vim hand-edits during onboarding are still a documented non-goal.

Step 2's parallel `POST /api/mcps` calls each acquire/release the config lock independently — `proper-lockfile` is reentrant per process but serial across processes. With N picked MCPs, N writes serialize. That's correct (each is its own atomic event) and fine for N ≤ 10.

## Testing

| Layer | Coverage |
|---|---|
| `src/config/schema.test.ts` (additions) | `LlmConfigSchema` happy/bad URL/bad model; `OnboardingSchema` defaults; ScryConfig with onboarding round-trip |
| `src/config/dotenv-write.test.ts` NEW | merge/append/quote/lock-serialize/comment-preserve |
| `src/server/llm-test.test.ts` NEW | fetch mocked; happy / 401 / network error / timeout / `${REF}` not in env |
| `src/server/routes/onboarding.test.ts` NEW | GET on missing/partial/full configs; POST complete; POST skip llm/mcps; PUT env; CSRF rejection on each verb |
| `src/server/routes/llm.test.ts` NEW | PUT happy/400/412; literal vs `${REF}` write paths; `.scry.env` written for literals; POST test happy/422 |
| `src/server/routes/mcps-discover.test.ts` NEW | bundled list shape; PATH-installed detection; 412 on missing config |
| `web/src/routes/Onboarding.test.tsx` NEW | step derivation from server state (4 cases); rail navigation; URL sync; re-entry after completion |
| `web/src/components/onboarding/OnboardingLlm.test.tsx` NEW | `${ANTHROPIC_API_KEY}` prefill on detectedRefs; localhost auto-checks proxy box; literal paste path; test pass/fail; skip writes flag |
| `web/src/components/onboarding/OnboardingMcps.test.tsx` NEW | bundled cards render; pick expands env block; per-card env input persists; Test & Continue runs in parallel; 422 → drop & continue removes entry; skip flag |
| `web/src/components/onboarding/OnboardingConfirm.test.tsx` NEW | summary renders both sections + skip warnings; finalize redirects |
| `web/src/components/RequireOnboarding.test.tsx` NEW | redirect on `!completed`; pass-through on completed; 412 also redirects |
| `web/src/components/LibrarySidebar.test.tsx` (additions) | Onboarding link visible iff `!completed`; refreshes on completion |

## Acceptance criteria

- Brand-new user with no `~/.config/scry/scry.config.yaml` runs `scry serve`, opens browser, lands on `/onboarding` Step 1 (auto-redirect via `RequireOnboarding` on the `/` route's 412).
- After completing all 3 steps with at least one working MCP, lands on `/` and a real search returns results from configured sources.
- Browser refresh during Step 2 lands back on Step 2 with prior picks pre-loaded (re-entrant).
- LLM auth field detects `process.env.ANTHROPIC_API_KEY` and prefills `${ANTHROPIC_API_KEY}` with "Detected — leave as-is" copy.
- Localhost `base_url` triggers the "No auth required" checkbox, default-checked.
- Pasting a literal token writes `${SCRY_LLM_TOKEN}` to `scry.config.yaml`'s `llm.auth_token` and `SCRY_LLM_TOKEN=<value>` to `.scry.env`.
- For each picked bundled MCP, `mcp_servers.<name>.env` block is written with `${VAR_NAME}` refs matching `bundled-servers.ts`'s `envVars[]`; literals land in `.scry.env`.
- Health-check failure on one MCP (e.g. wrong token) renders an inline error with "Drop & continue" — dropping it removes its entry from disk and proceeds.
- Skip Step 1 with no LLM configured → banner on `/`: "LLM not configured — searches will fail until you complete LLM setup."
- Skip Step 2 → banner on `/`: "No MCPs configured — search has no sources."
- Direct nav to `/onboarding` after completion lands on Step 3 with editable rail.
- `npm test` passes: full backend + web suites green. Backend ≥ 220 tests; web ≥ 60 tests.

## Risks

| Risk | Mitigation |
|---|---|
| Real LLM test call costs tokens / has latency | 1-token completion of fixed minimal prompt; 5s timeout; not cached (idempotent enough). |
| `.scry.env` merge clobbers user comments around modified keys | `writeDotEnv` is best-effort comment-preserving; documented as "comments around `SCRY_*` keys may be reflowed." Comments on unchanged keys survive byte-for-byte (golden test). |
| Step 2's "test all" is slow when N MCPs are picked | Parallel via `Promise.allSettled`; per-card spinner during; user sees progress card-by-card. |
| Custom MCP's env block has no `envVars[]` metadata | The `McpAddModal` already lets the user specify env keys — no auto-population for custom MCPs, the user pastes manually. Documented as "auto-env-block writing is bundled-only." |
| User edits `~/.claude.json` after `/api/mcps/discover` runs | Discover is read-on-mount only; user can refresh the page to re-discover. Documented as a non-goal: live PATH watching. |
| Existing-config users get auto-redirected into the wizard | First-`GET /api/onboarding` heuristic: IF the `onboarding` block is **entirely absent** from the config AND `llm` is present AND `mcp_servers` is non-empty, server auto-writes `onboarding: { completed: true }` BEFORE returning the response (single round-trip — the response reflects the post-write state). The heuristic does NOT run if the `onboarding` block exists with `completed: false` (the user actively skipped, don't second-guess). Tested. |
| `RequireOnboarding`'s redirect loops with the auto-write heuristic | The auto-write happens BEFORE the response; the response always has the post-write state. Single round-trip per page load. Tested. |
| LLM test endpoint becomes a credential-validation oracle (someone could query `/api/llm/test` with stolen tokens to test them) | CSRF middleware applies (already mounted globally, Plan A). Local-only binding (`127.0.0.1`) bounds blast radius. Documented; same threat model as Plan E's `/api/mcps/:name/test`. |

## Decision log

- **Auto-redirect on 412 from non-onboarding routes**, via one `RequireOnboarding` wrapper. Keeps the trigger mechanic in one place.
- **One `GET /api/onboarding` endpoint, client derives step.** Server stays dumb; UI logic stays in the UI; one round-trip on mount.
- **Per-step writes, not whole-wizard atomic.** Refresh-safe, re-entrant; partial states are valid scry configs.
- **Bundled cards + custom modal**, not bundled-only. Plan G is the web equivalent of `scry init`, not a stripped-down version. Custom MCPs reuse `McpAddModal` from Plan E.
- **Auto-env-block writes use `${VAR_NAME}` refs keyed to `bundled-servers.ts`'s `envVars[]`.** The per-entry env-allowlist (Plan E security boundary) automatically covers these because the wizard only writes refs to keys it just declared.
- **Block-by-default with explicit named-consequence skip + persistent banner.** Honest UI copy at skip time and on `/` until fixed.
- **Vertical rail UI**, not horizontal stepper. Re-entry is one click; always-visible context matches per-step persistence.
- **`onboarding` block lives in `scry.config.yaml`**, not a separate file. One config, one source of truth.
- **`SCRY_LLM_TOKEN` for literal-paste tokens**, not `ANTHROPIC_API_KEY`. The latter is the user's environment; the former is scry's vault. Don't mix.
- **LLM test uses raw fetch**, not the Anthropic SDK. Custom proxies (Hyperspace etc.) work transparently.
- **Auto-complete heuristic for existing configs** — runs only when the `onboarding` block is entirely absent (i.e., a config from before Plan G shipped). If the block exists with `completed: false`, the user is mid-wizard or actively skipped; don't override.

## Open questions (none blocking implementation)

- Should the LLM test endpoint expose token usage in the response? (Decision: no — it's a 1-token call, opacity is fine.)
- Should the wizard track time-to-complete for telemetry? (Decision: no — single-user tool, no telemetry pipeline.)
- Should we eventually support OpenAI-compatible endpoints? (Decision: out of scope; spec is Anthropic-shaped only. The base_url field accepts arbitrary URLs but the test endpoint assumes Anthropic Messages API.)

---

End of design.
