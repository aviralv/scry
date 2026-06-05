# 2026-06-05 — scry: Plan G shipped (onboarding wizard)

## Theme

Continued the multi-day Plan G execution from the 2026-06-03 start. Worked through Tasks 5–20 (16 tasks plus Task 10.5 inserted concurrency fix), 7+ smoke-driven fixes, and parallel adversarial review (GPT-4.1 + Gemini 2.5 Pro). PR #19 squash-merged to `main` as commit `2709070`. The wizard works end-to-end: brand-new user → wizard → working search with cited results from Slack + Confluence/Jira.

## What got built (Plan G — all 20 tasks + 2 inserted)

**Server (Tasks 5–10.5):**
- `src/server/ssrf.ts` — `isAllowedBaseUrl(url)`. https-only with `localhost`/`127.0.0.1` carve-out for proxies. Rejects RFC1918 (10/8, 172.16/12, 192.168/16), link-local (169.254/16), loopback `127.0.0.0/8` (other than the explicit carve-out), `0.0.0.0/8`, CGNAT 100.64.0.0/10, benchmark 198.18.0.0/15, multicast 224.0.0.0/4, IPv6 link-local + unique-local. 41 tests.
- `src/server/llm-test.ts` — `runLlmTest(input)`. SSRF guard; `${*_AUTH_TOKEN}` → `Authorization: Bearer`, `${*_API_KEY}` → `x-api-key`, literal → both. 1-token completion against `<base>/v1/messages`, 5s timeout (15s when called from wizard). Resolves `${REF}` from `process.env`; clean error when missing.
- `src/server/migrations/onboarding-autocomplete.ts` — runs at `scry serve` boot. If `onboarding` block absent + `llm` present + ≥1 mcp_servers → writes `onboarding: {completed: true}`. Idempotent. Stops the wizard from hijacking pre-G users.
- `src/server/routes/llm.ts` — `PUT /api/llm` and `POST /api/llm/test`. Literal auth_token → `${SCRY_LLM_TOKEN}` (config) + literal value (`.scry.env`). `${REF}` stays as ref. Clears `onboarding.llm_skipped` on successful PUT.
- `src/server/routes/mcps-discover.ts` — `GET /api/mcps/discover` returns `{bundled, pathInstalled}`.
- `src/server/routes/onboarding.ts` — `GET /api/onboarding`, `POST /api/onboarding/{complete,skip,mcps}`. GET is pure-read; `mcps` does optimistic-then-authoritative dup check, health-check (15s for cold-starts), atomic env+config write, clears `mcps_skipped` on success. `envValues` for user-typed values, `envRefs` for keys already in `.scry.env` (no overwrite).

**Server helpers (Tasks 3, 4, 4.5, 10.5):**
- `src/config/dotenv-write.ts` — comment-preserving merge into `.scry.env`. Rejects `\r`/`\n` in values. File-locked via `proper-lockfile`.
- `src/config/write-config-pair.ts` — `writeConfigAndEnv(cfg, env, mergeFn, kv)`. Two-phase: env first (validates synchronously), config second (validates inside lock).
- `src/config/write-config.ts` (refactored) — `writeConfig(path, mergeFn)` callback API. Merge runs INSIDE the file lock. Eliminates a race that pre-existed in Plan E (Task 4.5).
- `src/config/write-config.ts` (additions) — `writeConfigDoc(path, mutator)` for routes that mutate `llm:`/`onboarding:` blocks (outside `WriteConfigUpdates` shape). Same lock-and-mutate pattern (Task 10.5).
- `src/config/schema.ts` — `LlmConfigSchema`, `OnboardingSchema`. `RegistrySchema` widened with `.default({})` on sub-keys.
- `src/server/boot.ts` — auto-creates empty `scry.config.yaml` on first launch (skeleton has `llm: {}`, `mcp_servers: {}`, `search_tools: {}`). Logs resolved config path. Invokes startup migration before HTTP listener.

**Web (Tasks 11–18):**
- `web/src/lib/{onboarding,llm,mcps-discover}.ts` — three typed clients over `apiJson`. `BundledServerView` narrows server's `BundledServer` (omits `searchTools`).
- `web/src/components/RequireOnboarding.tsx` — wraps `/`, `/mcps`, `/registry`. Reads onboarding state on mount + `document.visibilitychange`. Redirects on `!completed` or 412. Fail-open on unexpected errors.
- `web/src/components/onboarding/OnboardingRail.tsx` — left rail with three step rows + status circles + summaries.
- `web/src/components/onboarding/OnboardingLlm.tsx` — Step 1 form. Detects `${ANTHROPIC_AUTH_TOKEN}` (preferred) or `${ANTHROPIC_API_KEY}` and prefills. Localhost shows "no auth required" checkbox (default-unchecked after smoke; localhost ≠ no-auth).
- `web/src/components/onboarding/OnboardingMcpCard.tsx` — single-card UI. Picked checkbox, env inputs, `(from .scry.env)` placeholder + Override button when key in `detectedEnvKeys`, install hint when not on PATH.
- `web/src/components/onboarding/OnboardingMcps.tsx` — Step 2. `discoverMcps` on mount. Validates picked cards have all required env (typed or detected) before submission. Trims env values before sending. Parallel `addOnboardingMcp` per card. anyOk → advance. Skip writes `mcps_skipped`. Custom MCP via existing `McpAddModal`.
- `web/src/components/onboarding/OnboardingConfirm.tsx` — Step 3 read-only summary + Finalize.
- `web/src/routes/Onboarding.tsx` — orchestrator. `?step=N` URL bound by `Math.min(urlStep, derived)` (URL can go back, not skip ahead).
- `web/src/App.tsx`, `LibrarySidebar.tsx`, `Search.tsx`, `McpManager.tsx`, `Registry.tsx` — wired up: route-mount, `RequireOnboarding` wrappers, skip-flag banners, 412 stubs replaced with `<Navigate>`.

**Tests:**
- Backend: 199 (pre-G) → **332** (+133)
- Web: 42 (pre-G) → **93** (+51)
- `tsc --noEmit` clean

## Key Decisions

- **Sidebar Onboarding NavLink dropped during smoke.** Originally planned for "show when not completed, hide after." But auto-redirect handles the unconfigured case, and the link adds zero value at any state. UI clutter for nothing.
- **Bearer auth header for `${*_AUTH_TOKEN}` refs, x-api-key for `${*_API_KEY}`, both for literals.** claude-agent-sdk uses Bearer with `ANTHROPIC_AUTH_TOKEN` (proxy convention); Anthropic-direct uses x-api-key with `ANTHROPIC_API_KEY`. The original wizard only sent x-api-key — broke Hyperspace flow. Caught during smoke.
- **Localhost ≠ no-auth.** Original auto-checked the "no auth required" checkbox for localhost URLs. Hyperspace at `localhost:6655` requires auth. Wrong assumption produced 401s. Removed the auto-check; checkbox visible for localhost but defaults unchecked.
- **`envRefs` field added mid-flight for prefill semantics.** Initial design: `envValues: {}` → server writes no env block → MCP child can't see vars at runtime. Added `envRefs: string[]` so prefilled keys (already in `.scry.env`) get declared in the config's env block as `${K}` refs without overwriting `.scry.env`. Different from `envValues` (user-typed values that DO get written).
- **15s health-check timeout for write paths, 5s for manual `/test`.** Real MCP cold-starts (Atlassian handshake, Slack init) legitimately take 5–10s. Plan E's 5s default was set against fake fixtures.
- **Slack doesn't need `SLACK_TOKEN`.** Task 1 speculatively added it to `bundled-servers.ts`. Wrong: slack-mcp uses Slack desktop app's saved session, not an API token. Removed during smoke.
- **`writeConfig` callback API (Task 4.5).** Pre-existing race in Plan E: `writeConfig(path, updates)` did wholesale-replace with read-outside-lock. Two parallel POSTs each computed merged map from stale snapshot, last-write-wins dropped the loser silently. Refactored to `writeConfig(path, mergeFn)` with merge running INSIDE the lock. Wizard's parallel Step 2 cards depended on this.
- **`writeConfigDoc` for non-`WriteConfigUpdates` blocks (Task 10.5).** `writeConfig` only validates `mcp_servers` + `registry`. Routes writing `llm:` or `onboarding:` blocks (atomicWriteConfig direct) had the same race. New helper holds the lock around arbitrary `doc.set()` calls.
- **Empty-config bootstrap with `llm: {}` block.** Originally `mcp_servers: {} \n search_tools: {} \n` — but `ScryConfig.llm` is non-optional; user opening wizard then closing without finishing Step 1 → CLI search would TypeError. Skeleton now includes `llm: {}` (Gemini's catch).
- **URL `?step=N` bounded by derived state.** Original allowed `?step=3` skip-ahead with empty state. Now `Math.min(urlStep, derived)` — URL can go back, not forward (Gemini's catch).
- **Two pre-existing bugs filed, deferred (issues #15, #16, #18).** Stderr-routing for boot logs, stale `SCRY_LLM_TOKEN` on proxy switchover, `noAuth` checkbox preference wipe on baseUrl change. Not blocking.

## Smoke-driven fixes (Task 19)

Real-workspace smoke caught bugs unit tests can't:

1. **Empty-config bootstrap missing entirely** — wizard's PUT/POST endpoints 412-loop forever for brand-new user. Added `writeFileSync` of skeleton in `boot.ts`.
2. **Bearer-vs-x-api-key auth header mismatch** — explained above.
3. **Step 2 prefill didn't work** — `detectedEnvKeys` was on the wire but never consumed. Wired through Onboarding route → OnboardingMcps → OnboardingMcpCard with `overrides: Set<string>` for explicit user-edit mode.
4. **`envRefs` server gap** — explained above.
5. **5s health-check too tight** — explained above.
6. **Slack auto-passed without token, looked confusingly broken** — turned out slack-mcp doesn't need a token at all (uses desktop session). Removed `envVars: ['SLACK_TOKEN']` from Slack entry.
7. **Picked card with required env missing → false-positive ✓** — slack-mcp's MCP `initialize` doesn't validate auth, so wizard reported success on a config that would fail at search time. Added client-side validation: block submission for picked cards whose `envVars` include keys neither prefilled nor user-typed.

## Adversarial review (Task 20)

**GPT-4.1 (GPT-5 unreachable, same fallback as PRs #14, Plan E spec)** — applied 2 of 12:
- SSRF gaps: 127.0.0.0/8 loopback (beyond exact 127.0.0.1 carve-out), 0.0.0.0/8, CGNAT, benchmark, multicast, broadcast. **Real bug.**
- Whitespace-padded env values not trimmed before submit. **Real bug.**
- Dismissed: DNS rebinding (out of scope), Bearer/x-api-key fallback (intentional), modal close on rejected onSubmit (can't reject in this codebase), skip-flag-after-vim-edit (low severity for single-user CLI), and writeConfigAndEnv dangling-env (already documented + tested).

**Gemini 2.5 Pro** — applied 2 of 6:
- Boot skeleton missing `llm: {}` causing CLI TypeError. **Real bug.**
- URL `?step=N` skip-ahead. **Real bug.**
- Dismissed: timing attacks on env-var existence (local-only server), `detectedEnvKeys` disclosure (the prefill feature requires it), `SCRY_LLM_TOKEN` clobber (the wizard owns this slot; randomized suffix would leak unbounded keys), CSRF token rotation (acceptable for local-only single-user CLI).

Both reviews caught different angles — running them in parallel was the right call.

## Files touched (high level)

58 files in the squash, +4088/-84:

**New server files (10):** ssrf, llm-test, llm route, mcps-discover route, onboarding route, dotenv-write, write-config-pair, onboarding-autocomplete migration, plus their tests + CSRF tests.

**Modified server files (4):** schema (LlmConfig + Onboarding schemas, Registry defaults), write-config (callback refactor + writeConfigDoc + ConfigNameExistsError + ConfigNotFoundError), boot (config-path log + skeleton + migration), bundled-servers (slug field).

**New web files (10):** RequireOnboarding, OnboardingRail, OnboardingLlm, OnboardingMcpCard, OnboardingMcps, OnboardingConfirm, Onboarding route, three lib clients.

**Modified web files (5):** App (route mount + RequireOnboarding wrapping), LibrarySidebar, Search (banners), McpManager (412 stub), Registry (412 stub).

**Spec + plan + session notes:** docs/superpowers/specs/, docs/superpowers/plans/, session-notes/.

## Open follow-ups (post-merge)

- **Issue #15** — route boot logs through stderr / structured logger (deferred from PR #14)
- **Issue #16** — stale `SCRY_LLM_TOKEN` on proxy switchover
- **Issue #18** — `OnboardingLlm` `noAuth` checkbox preference wipe on `baseUrl` change
- **Plan H** — Preferences pane (theme, fanout default, read-only env/MCP detection)
- **Plan I** — E2E tests via Playwright + npm publish bump
- **Issue #9** — Markdown rendering in answer panel (still open from before Plan G)
- **Issue #7** — Engine fabricates parenthetical role/affiliation labels (still open)

## Next Steps (committed order)

1. **Issue #9 — Markdown rendering in answer panel.** Most visible quality gap right now — UI everywhere else is polished, search answers look raw. `react-markdown` with citation-preserving `components` overrides.
2. **Issue #7 — Engine fabricates parenthetical role/affiliation labels.** System-prompt nudge candidate; needs eval set before tuning.
3. **Plan I — E2E hardening + npm publish bump.** Required before any external sharing.
4. **Plan H — Preferences pane.** UI affordance; rounds out the surfaces.

Plan G's value: scry is now shareable. A user with no prior scry config can `npm install -g @aviralv/scry`, run `scry serve`, walk the wizard, and get a working federated search in <5 minutes. That was the year-long unlock.

## Learnings

- **Smoke testing surfaces the real bugs unit tests can't.** 7+ bugs caught in Task 19 that 332 backend + 93 web tests didn't surface. The bugs were all "how the system behaves end-to-end with real services" — empty-config bootstrap, Bearer auth, prefill UX, envRefs server gap, timeout-vs-cold-start, Slack-doesn't-need-token. Real-workspace smoke is non-negotiable for any UX-touching plan.
- **Pre-existing bugs surface when usage patterns change.** Plan E's `writeConfig` race was latent because the manager UI is single-shot. Plan G's parallel wizard hit it hard. Same for `writeConfigDoc` (Task 10.5) — same class of bug, different surface. Always re-check existing infrastructure when introducing new concurrency patterns.
- **The implementer-flag-deviations pattern paid off repeatedly.** Task 2's auth_token alignment, Task 4's validateConfigUpdates extraction, Task 12's RequireOnboarding test rewrite, Task 17's getAllByRole disambiguation — all were the implementer correctly identifying issues with my plan and surfacing them via DONE_WITH_CONCERNS. Without that explicit channel I'd have to reverse-engineer from diffs.
- **Two-stage review (spec + code quality) catches different things.** Spec compliance caught wrong API shapes, missing tests, inverted assertions. Code quality caught misnamed tests (Task 4 concurrent test only checked env), shadow bugs (`ConfigNameExistsError`'s `public name` field), unsafe casts. One-stage review would have missed half of these.
- **Run BOTH GPT and Gemini for adversarial review.** They genuinely catch different angles. GPT-4.1 caught SSRF range gaps and whitespace; Gemini caught boot-skeleton llm-block and URL skip-ahead. Neither would have caught what the other did.
- **The OneDrive stale-files incident from 2026-06-03 stayed clean this session.** The pre-flight working-tree cleanliness check + reviewer guidance ("git ls-files before treating as production code") prevented a recurrence even though I didn't think about it once. Cheap defense.
- **"Plan G is the biggest unlock for shareable scry" was correct.** End-to-end smoke validation: wizard → search returning Slack + Confluence citations. That's the year-long unlock. All the other planned surfaces (H prefs, I e2e) are polish on top of this primitive.

## Tags

`#scry` `#plan-g` `#onboarding-wizard` `#shipped` `#subagent-driven` `#smoke-driven` `#multi-model-review` `#concurrency-fix` `#ssrf` `#bearer-auth` `#prefill-ux`
