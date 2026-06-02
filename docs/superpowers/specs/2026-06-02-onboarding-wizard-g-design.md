# scry Plan G — onboarding wizard — design spec

**Date:** 2026-06-02
**Status:** Draft, pending user approval
**Builds on:** Plans E (MCP manager) + F (Registry editor) merged on `main`
**Reviewed by:** Claude (author); GPT-4.1 + Gemini 2.5 Pro adversarial pass (GPT-5 timed out, fell back to GPT-4.1 — same fallback used on Plans C/E and PR #14). Findings triaged; spec revised. See "Dismissed reviewer points" at the bottom.

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
- **Refreshes onboarding state on `document.visibilitychange`** (tab regains focus) so a wizard completed in another tab doesn't leave this tab redirecting forever. Implementation: a small `useEffect` listener that re-runs the GET when `document.visibilityState === 'visible'`. Lightweight; no library.
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
3. On `ok: true`: client calls `PUT /api/llm` with the same body. Server validates with `LlmConfigSchema` (including SSRF allowlist on `base_url`). If `auth_token` is present and **does NOT match** `^\$\{[A-Z][A-Z0-9_]*\}$`, server uses the new `writeConfigAndEnv` helper (see "Two-phase write" below) to atomically write both `.scry.env` (`SCRY_LLM_TOKEN=<value>`, overwriting any previous value silently — the wizard owns this key) and the `llm:` block in config (with `auth_token` rewritten to `${SCRY_LLM_TOKEN}`). Otherwise (token is already a `${REF}` shape, or no token), only the config write happens. Both paths also clear `onboarding.llm_skipped` if it was set. Returns 200; client advances to Step 2.
4. On `ok: false`: red banner under the form. Two affordances: "Retry" (re-runs the test) and "Skip — searches will fail until fixed" (POST `/api/onboarding/skip` with `{ step: 'llm' }` → writes `onboarding.llm_skipped: true`, advances to Step 2).

### Validation rules

- `base_url` must be a valid URL (`z.string().url()`).
- `base_url` is checked against an **SSRF allowlist** before any outbound call: scheme must be `https://` OR `http://localhost`/`http://127.0.0.1` (with optional `:port`). Any other scheme (`file://`, `ftp://`, etc.), any RFC1918 address (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), any link-local (`169.254.0.0/16`), and any IPv6 unique-local / link-local is rejected with 400. The localhost carve-out exists for legitimate proxy users (e.g. `http://localhost:6655/anthropic/`); without the carve-out, proxy users couldn't onboard. The check happens in both `PUT /api/llm` (write-time validation) and `POST /api/llm/test` (test-time validation) so a malicious page can't smuggle an internal-IP base_url through one path and exploit it through the other.
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

Below the bundled cards: a dashed "+ Add custom MCP" tile. Clicking opens the existing `McpAddModal` from Plan E with a wizard-context flag. The modal:

- In manager mode (Plan E behavior): does its own `POST /api/mcps`, closes on success.
- In **wizard mode** (new): does NOT call `POST /api/mcps` itself. Instead, it accepts an `onSubmit(serverData)` callback from the wizard. On submit, the modal calls `onSubmit({ name, command, args, env })` (with the env block as the user typed it) and the wizard treats this as "add a custom card to the picked list," with the same env-input UX as bundled cards. The wizard's "Test & Continue" then handles the actual write via `POST /api/onboarding/mcps`. This avoids double-writes, double health-checks, and stale state between modal close and wizard refresh.

The `McpAddModal` change is one new prop: `onSubmit?: (data: McpServerData) => void`. When set, the modal short-circuits its internal POST. Backward compatible — existing manager-surface callers don't pass `onSubmit` and get the old behavior.

### Test & Continue

1. For each picked card, client calls a new wizard-only endpoint `POST /api/onboarding/mcps` with `{ name, command, args?, envValues: { VAR_NAME: <user-entered-value> } }`. The server constructs the env block formulaically from `bundled-servers.ts` (or, for custom MCPs, from the modal-provided env block), runs `healthCheck`, and on success uses `writeConfigAndEnv` to atomically write both the env values to `.scry.env` and the new `mcp_servers.<name>` entry (with `env: { VAR_NAME: "${VAR_NAME}" }`) to config. Also clears `onboarding.mcps_skipped` if set.
2. Each card runs in parallel via `Promise.allSettled`. The two-phase write inside each call serializes via the file lock — N picked cards means N atomic writes, in arbitrary order, each one all-or-nothing. Per-card spinner during.
3. Plan E's existing `POST /api/mcps` (which takes a fully-formed env block in the body) stays as-is for the manager surface. The wizard uses its own endpoint because the env-block construction is wizard-specific and the env values need to flow to `.scry.env` atomically.

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
                                       PURE READ — no side effects.
POST   /api/onboarding/complete     → 200 { completed: true } | 412
POST   /api/onboarding/skip         body: { step: 'llm' | 'mcps' }
                                     → 200 { onboarding } | 400 | 412
POST   /api/onboarding/mcps         body: { name, command, args?, envValues }
                                     → 201 { server } | 400 | 409 name-exists
                                       | 422 health-check-failed | 412
                                     Wizard-only. Constructs env block from envValues,
                                     runs health-check, atomically writes config + .scry.env,
                                     clears mcps_skipped flag.
PUT    /api/llm                     body: { base_url, auth_token?, model }
                                     → 200 { llm } | 400 | 412
                                     SSRF-checks base_url. If auth_token is literal,
                                     atomically writes config + .scry.env. Clears llm_skipped.
POST   /api/llm/test                body: { base_url, auth_token?, model }
                                     → 200 { ok: true } | 200 { ok: false, error } | 400
                                     SSRF-checks base_url before any outbound call.
GET    /api/mcps/discover           → 200 { bundled, pathInstalled } | 412
```

`GET /api/onboarding` returns an aggregated view; it does NOT compute the active step (per Q5 / Q-arch decision: server stays dumb, client derives) and does NOT perform any writes. The auto-complete migration runs at `scry serve` boot, separately (see "Concurrency & file locks" → "Auto-complete migration").

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

- **Rejects values containing `\n` with a thrown `DotEnvValidationError`** before any write. Multi-line env values are out of scope; the wizard never legitimately produces them, and the parser/writer round-trip is fragile around them. Schema validation upstream (in `LlmConfigSchema` and the wizard form) catches this earlier; `writeDotEnv` enforces it as a runtime invariant.
- Acquires `proper-lockfile` on `<path>.lock`.
- If file exists: reads, parses into `Map<string, string>` preserving order and surrounding comments. Updates existing keys, appends new ones. Comments adjacent to a key (immediately preceding or trailing on the same line) move with the key. Comments on unchanged keys survive byte-for-byte.
- If file does not exist: creates with `KEY=value` lines, no comments.
- Values containing `"` or `'` get double-quoted with backslash escaping. Values matching `^[A-Za-z0-9._/=:@+-]+$` are written bare.
- Atomic write: tmp + fsync + rename. (When called via `writeConfigAndEnv`, the rename is the second of the two-phase commit.)

Tests cover: idempotent merge, comment preservation for unchanged keys, value quoting, `\n` rejection, concurrent writes serialize via lock.

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

Step 2's parallel `POST /api/onboarding/mcps` calls each acquire/release the config lock independently — `proper-lockfile` is reentrant per process but serial across processes. With N picked MCPs, N writes serialize. That's correct (each is its own atomic event) and fine for N ≤ 10.

### Two-phase write across `.scry.env` + `scry.config.yaml`

`PUT /api/llm` and Step 2's MCP write each touch BOTH files. Without coordination, a partial failure (env written, config write fails — or vice versa) leaves the system in an inconsistent state: orphaned secret in `.scry.env` with no reference, OR config pointing to a `${SCRY_LLM_TOKEN}` that doesn't exist in `.scry.env`.

The solution is two-phase write with rollback:

1. Acquire BOTH file locks (`scry.config.yaml.lock` first, then `.scry.env.lock` — alphabetical order to prevent deadlock between two routes that touch both).
2. Stage `.scry.env` to `<path>.tmp` (no rename yet).
3. Stage `scry.config.yaml` to `<path>.tmp` (no rename yet) AND validate via zod.
4. If both staged successfully: rename config tmp → config, then rename env tmp → env. Order matters: config first so a failure between renames leaves config pointing at a stale env value (recoverable on next save) rather than a stale secret in env with no config reference.
5. If any step fails: unlink both tmp files, do NOT rename, return error. Existing files are unchanged.
6. Release locks in finally.

This is a new helper, `writeConfigAndEnv(configPath, configUpdates, envKv)`, that wraps `writeConfig` and `writeDotEnv` into one atomic-pair operation. Lives in `src/config/write-config.ts` next to the existing `writeConfig`.

`PUT /api/llm` and Step 2's wizard write both call `writeConfigAndEnv` (Step 2 once per MCP, since each MCP is its own atomic event). Plan E's existing `POST /api/mcps` route stays as-is for non-wizard callers (no env write needed there — env values come from the schema-validated body). The wizard's path is the new branch.

### Auto-complete migration (server startup)

The auto-complete heuristic for existing pre-G configs runs **once at `scry serve` boot**, not inside `GET /api/onboarding`. This keeps the GET pure-read and avoids the read-check-write race on parallel browser tabs.

Migration logic (`src/server/migrations/onboarding-autocomplete.ts`):
1. After `loadConfig` resolves, check: is `onboarding` block absent AND `llm` present AND `mcp_servers` non-empty?
2. If yes: acquire config lock, re-read (in case startup races a concurrent `scry serve` — unlikely but cheap), re-check the condition, write `onboarding: { completed: true }` via `writeConfig`. Idempotent.
3. If `onboarding` block exists with any state (including `completed: false`), do nothing — the user actively skipped or hand-edited.
4. Logs the migration outcome to stderr ("scry: marked existing config as onboarding-complete" or "scry: no migration needed").

Tested as a unit (loadConfig + migration is a pure function pair).

## Testing

| Layer | Coverage |
|---|---|
| `src/config/schema.test.ts` (additions) | `LlmConfigSchema` happy/bad URL/bad model; SSRF allowlist (https / localhost / 127.0.0.1 OK; RFC1918, link-local, file://, ftp:// rejected); `OnboardingSchema` defaults; ScryConfig with onboarding round-trip |
| `src/config/dotenv-write.test.ts` NEW | merge/append/quote/lock-serialize/comment-preserve; `\n` rejection throws DotEnvValidationError |
| `src/config/write-config.test.ts` (additions) | `writeConfigAndEnv` happy path; rollback on env staging failure; rollback on config staging failure; rollback on validation failure; deadlock-free with concurrent calls; rename order (config then env) |
| `src/server/migrations/onboarding-autocomplete.test.ts` NEW | runs when block absent + llm + mcps; no-op when block exists with completed: false; no-op on missing llm; no-op on empty mcps; logs to stderr |
| `src/server/llm-test.test.ts` NEW | fetch mocked; happy / 401 / network error / timeout / `${REF}` not in env; SSRF allowlist enforced (rejects RFC1918 etc. with 400 BEFORE fetch) |
| `src/server/routes/onboarding.test.ts` NEW | GET on missing/partial/full configs (PURE READ — no writes); POST complete; POST skip llm/mcps; POST mcps happy/422/409/atomic-write-pair; CSRF rejection on each verb |
| `src/server/routes/llm.test.ts` NEW | PUT happy/400/412; SSRF rejection on PUT; literal vs `${REF}` write paths; atomic two-phase write; `llm_skipped` cleared on successful write; POST test happy/422; SSRF rejection on POST test |
| `src/server/routes/mcps-discover.test.ts` NEW | bundled list shape; PATH-installed detection; 412 on missing config |
| `web/src/routes/Onboarding.test.tsx` NEW | step derivation from server state (4 cases); rail navigation; URL sync; re-entry after completion |
| `web/src/components/onboarding/OnboardingLlm.test.tsx` NEW | `${ANTHROPIC_API_KEY}` prefill on detectedRefs; localhost auto-checks proxy box; literal paste path; test pass/fail; skip writes flag |
| `web/src/components/onboarding/OnboardingMcps.test.tsx` NEW | bundled cards render; pick expands env block; per-card env input persists; Test & Continue runs in parallel; 422 → drop & continue removes entry; skip flag; custom MCP via modal flows through `POST /api/onboarding/mcps` (single write, no modal-side POST) |
| `web/src/components/McpAddModal.test.tsx` (additions) | `onSubmit` prop short-circuits internal POST; without `onSubmit`, manager-mode behavior unchanged |
| `web/src/components/onboarding/OnboardingConfirm.test.tsx` NEW | summary renders both sections + skip warnings; finalize redirects |
| `web/src/components/RequireOnboarding.test.tsx` NEW | redirect on `!completed`; pass-through on completed; 412 also redirects; visibility-change re-fetches state |
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
| Existing-config users get auto-redirected into the wizard | Server-startup migration runs once when `scry serve` boots: IF `onboarding` block is **entirely absent** AND `llm` is present AND `mcp_servers` is non-empty, write `onboarding: { completed: true }`. The migration is in `src/server/migrations/onboarding-autocomplete.ts` and is invoked from `boot.ts` after `loadConfig`. Idempotent. Two-tab race is impossible because migration runs before any HTTP listener accepts connections. The heuristic does NOT run if the `onboarding` block exists with `completed: false` (the user actively skipped, don't second-guess). Tested. |
| `RequireOnboarding`'s redirect is stale across tabs | The wrapper re-runs `GET /api/onboarding` on `document.visibilitychange` (tab regains focus). A wizard completed in another tab gets reflected in this tab on next focus. Tested. |
| Skip flag persists after user later configures the skipped piece | `PUT /api/llm` always clears `onboarding.llm_skipped`; `POST /api/onboarding/mcps` always clears `onboarding.mcps_skipped`. Documented as part of write logic. Tested. |
| Custom MCP added via `McpAddModal` causes double-write or stale wizard state | `McpAddModal` accepts an optional `onSubmit` prop in wizard context; with it set, the modal short-circuits its internal `POST /api/mcps` and hands the data to the wizard, which routes the actual write through `POST /api/onboarding/mcps` like any other picked card. Single write path. Tested. |
| `.scry.env` + config write partial-failure leaves orphaned secret | New `writeConfigAndEnv` helper performs two-phase write: stage both, then rename config first, then env. On any error, neither rename happens. Tested. |
| LLM test endpoint becomes a credential-validation oracle (someone could query `/api/llm/test` with stolen tokens to test them) | CSRF middleware applies (already mounted globally, Plan A). Local-only binding (`127.0.0.1`) bounds blast radius. Documented; same threat model as Plan E's `/api/mcps/:name/test`. |
| **SSRF via attacker-controlled `base_url`** — a malicious page in the user's browser could trick scry into making outbound HTTP calls to internal-network addresses | Strict allowlist (https-only, plus an explicit `http://localhost` / `http://127.0.0.1` carve-out for proxies). RFC1918, link-local, and non-loopback private addresses rejected with 400 BEFORE any fetch. Validation runs in both `POST /api/llm/test` and `PUT /api/llm` so neither path can be smuggled through. Tested with adversarial inputs. |

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
- **Auto-complete migration runs at server startup, not in `GET /api/onboarding`.** Keeps the GET pure-read; eliminates two-tab race; matches REST conventions; logs migration outcome to stderr for transparency.
- **Two-phase atomic write across config + .scry.env.** New `writeConfigAndEnv` helper. Both files staged, then renamed in order (config first, env second) so partial failure leaves a recoverable state, never an orphaned secret.
- **SSRF allowlist on `base_url`.** https-only with explicit `localhost`/`127.0.0.1` carve-out for proxies. Validation in BOTH `POST /api/llm/test` AND `PUT /api/llm` so neither path is smugglable.
- **Skip flags clear on subsequent configuration.** Write to LLM clears `llm_skipped`; write to MCPs clears `mcps_skipped`. Avoids the "user skipped, then configured, then later cleared, banner re-activates" trap.
- **Wizard uses `POST /api/onboarding/mcps`, not `POST /api/mcps`.** The wizard's mode includes atomic env-write + skip-flag clear; the manager's mode doesn't. Two endpoints with different write semantics; one helper underneath.
- **`McpAddModal` gets an optional `onSubmit` prop for wizard context.** Manager mode unchanged. Wizard mode short-circuits the modal's internal POST and routes data through the wizard's own write path.
- **`RequireOnboarding` re-fetches on visibility change**, not just on mount, so a tab that completed onboarding doesn't leave sibling tabs stuck redirecting.

## Open questions (none blocking implementation)

- Should the LLM test endpoint expose token usage in the response? (Decision: no — it's a 1-token call, opacity is fine.)
- Should the wizard track time-to-complete for telemetry? (Decision: no — single-user tool, no telemetry pipeline.)
- Should we eventually support OpenAI-compatible endpoints? (Decision: out of scope; spec is Anthropic-shaped only. The base_url field accepts arbitrary URLs but the test endpoint assumes Anthropic Messages API.)

## Dismissed reviewer points

- **GPT "remove `.scry.env` keys on Drop & continue"** — would erase a token the user typed and might want to retry with. The user's `.scry.env` is theirs; the wizard owns only the keys it currently has live references to in config. Documented behavior: dropped MCPs leave their env keys in `.scry.env` for the user to remove manually if desired. UX polish (a one-line note in the drop confirmation) is a follow-up, not a spec change.
- **GPT "skip LLM test on no-change re-entry"** — the test is fast (1-token, 5s timeout) and idempotent; the safety of "always tests reflect current reality" outweighs the saved token. A user editing Step 1 then immediately clicking Continue without changes is a rare path. Not optimizing.
- **GPT "audit token logging in `/api/llm/test`"** — already covered by Issue #15 (route boot logs through stderr / structured logger), filed during PR #14 review. Spec adds a one-liner in the test plan: "redaction asserted by test" — but no scope expansion here.
- **Gemini "use React Query / SWR for global state cache"** — `RequireOnboarding` only reads three fields once per visibility-change. Adding a query library for one component is overkill. The shared-cache concern is addressed by the visibility listener, which is the smaller fix that solves the actual bug Gemini identified.

---

End of design.
