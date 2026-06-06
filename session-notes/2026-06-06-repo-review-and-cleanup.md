# 2026-06-06 — scry: repo review + cleanup planning + #5 fix

## Theme

Post-PR-#22 maintenance day. Three things in one session:

1. **Fix CI green again** — PR #22's CI workflow had been failing on every run since merge (Node 20 vs Node 26 platform difference + missing config-stub in `tests/server/routes/search.test.ts`). PR #23 shipped the fix.
2. **Issue #5 — `tools: []` over `allowedTools`** — engine cleanup, eliminates 3+ wasted `Agent` calls per query. PR #24 shipped.
3. **Adversarial repository review** — what's load-bearing vs vestigial, where are the eval gaps, what should we delete vs consolidate. Output: a 5-PR cleanup plan agreed with Avi.

## What got built

**PR #23 — fix(test): stub config + poll for persistence in search.test.ts**
- Root cause: `tests/server/routes/search.test.ts` was passing on macOS because my real `~/.config/scry/scry.config.yaml` happened to exist; CI runners had no such file, so the search route's `configMissing` early-return kicked in and `persistTurn` was never reached. Tests checking `store.get('test-session')` got null.
- Fix: `beforeAll` writes a stub config to a temp dir and points `SCRY_CONFIG` at it. Plus a `waitForRow(id, timeoutMs)` helper that polls (10ms intervals, 2s ceiling) so the persistence tests don't race the SSE generator's tail microtasks across Node versions.
- Also caught: Node 20 vs Node 22+ resolves SSE response body's `text()` differently relative to generator microtask flush. Polling is the platform-independent fix.

**PR #24 — fix(engine): use tools:[] to disable built-in tools (#5)**
- Replaced `allowedTools: [...mcp tool names...]` with `tools: []` in `runQuery.ts` SDK options.
- The SDK's own d.ts comment says `allowedTools` is auto-allow, NOT a restrictor — `tools` is the restrictor. `tools: []` disables the entire built-in toolset (Task, Bash, Read, Edit, etc.). MCP tools come through `mcpServers`, not `tools`, so search continues to work.
- Live smoke against the real engine on Hyperspace: zero `→ Agent` / `→ Bash` lines in trace. 331 backend tests pass (was 330).

**Repository review** — see "Repo review punch-list" section below. Saved alongside this note as the canonical artifact.

## Key decisions

- **The review goes into `session-notes/` as the canonical artifact, not `docs/`.** Avi: "this is one of those artifacts I want to keep." Sessions are the right home for review snapshots; `docs/` is for live reference material.
- **The 5-PR split is accepted.** PRs A through E in the punch-list order, beginning today.
- **SQLite extension thread is real.** Beyond the punch-list deletions, the SQLite `sessions` table is one part of a bigger storage feature: extending it to **automatically populate the registry** (people, projects) from search activity. The current registry is hand-edited via the editor UI; the long-term thought is "as you search, scry learns who's who and what's what." That's a separate future plan, not this PR-batch — but worth keeping on the radar so we don't accidentally over-simplify the storage layer in cleanup.
- **Evals are a real first-class artifact going forward.** The synthesis-quality eval (Issue #7) was the first one; the affiliation regex caught nothing on Haiku 4.5 but the framework is there. As real bugs surface from limited usage, fixtures get added. The eval set should reflect "what we're trying to build" — citation fidelity, multi-turn integrity, registry-aware routing once that lands. We don't need to write a comprehensive eval suite up front; we let user-reported bugs drive fixture creation, and the framework grows organically.
- **CI Node version stays at 20** for now. It's a useful constraint that catches platform-dependent test patterns (PR #23 only existed because of this).

## Repo review punch-list

Read-only adversarial survey after PRs #20–#24. Findings batched into 5 PRs.

### Tier 1 — quick deletions (low risk, high signal) — **PR A**

- [ ] Delete `SearchResult`, `SearchAction`, `SynthesisResult`, duplicate `Citation` in `src/config/types.ts:67–96`. Plan A residue, zero production callers (only present in `.claude/worktrees/` snapshots).
- [ ] Delete `process.env.SCRY_MOCK_SESSION_SUFFIX` check in `src/engine/mock-runQuery.ts:47`. Never set anywhere.
- [ ] Delete `readConfigDoc` export from `src/config/write-config.ts:136–140`. Zero callers.
- [ ] Add `ClaudeConfigShape` interface to `src/discovery/claude-config.ts:12–37` (currently uses `any`).
- [ ] Remove `SLACK_TOKEN` from `WELL_KNOWN_ENV_REFS` in `src/server/routes/onboarding.ts`. Slack-mcp uses desktop auth; was already removed from `bundled-servers.ts` during Plan G smoke.

### Tier 2 — extractions / consolidations (medium risk) — **PR B**

- [ ] Extract `ENV_REF_RE` to `src/config/env-ref.ts` (capturing variant + `isEnvRef()` helper). Used in `llm-test.ts:15`, `mcp-health.ts:10`, `routes/llm.ts:10`. Review `loader.ts:resolveEnvVars` regex for compatibility.
- [ ] Move `McpServerEntry` + `toEntry` to shared types. Currently duplicated in `routes/mcps.ts:27`, `routes/onboarding.ts:29`, `web/src/lib/mcps.ts:3` with identical shapes.
- [ ] Delete `LlmTestInput` (uses `LlmConfig` instead). Delete `LlmConfigInput` in web. Add `LlmConfig` to `shared/types.ts` re-exports.
- [ ] Decide on `writeConfigAndEnv`: delete entirely (recommended — inline pattern handles `readDoc-inside-lock` semantics the helper can't express) OR convert call sites to use it.
- [ ] Delete `InsertSession` from `storage/types.ts:19–26`. Identical to `SessionRow`.

### Tier 3 — protocol / data shape changes — **PR C**

- [ ] Drop the `citation` event from SSE. Frontend discards it (`return prev` in Search.tsx). Either remove emission + type, or use it for progressive highlighting.
- [ ] Drop `raw: unknown` from `SourceCard`. Written but never read; bloats SSE stream and SQLite payload. Existing rows deserialize cleanly (extra keys silently ignored).
- [ ] Decide on `normalizer` field. README claims normalizers exist; reality is the engine is pure LLM synthesis with no normalizer dispatch. Either remove `normalizer` from `SearchToolConfig` + `bundled-servers.ts`, OR update README to reflect reality.

### Tier 4 — eval / test gaps — **PR D**

- [ ] `fanoutMode` end-to-end test (frontend checkbox → server route → `runQuery`). Each leg unit-tested but no chain test exists.
- [ ] `onboarding-autocomplete` boot integration test. Currently only the function is unit-tested; the boot path that invokes it isn't exercised.
- [ ] Multi-block `tool_result` test. `parseToolResult` says "first block wins" — exercise it.
- [ ] `resolveDeclaredEnv` boundary test in `mcp-health.ts`. Verify a `${REF}` in entry A's env block isn't resolved if `REF` is only declared by entry B.
- [ ] Synthesis eval — multi-turn fixtures. Today's 7 fixtures are all single-turn. Add one exercising follow-up via the `priorSources` path (assuming we wire it; see Tier 5).
- [ ] Synthesis eval — citation-fidelity check. A fixture asserting "every cited `[N]` corresponds to a real source in the prompt." Currently we only check for forbidden affiliation patterns.

### Tier 5 — open questions / decisions — **PR E**

- [ ] **`priorSources` is dead-end wiring.** `RunQueryOptions` accepts it but the search route never populates it; `SourceTracker` is constructed with `[]` from the server path. Either populate from the SQLite store (real cross-turn citation continuity) OR remove from `RunQueryOptions`. Recommendation: **remove** — the SDK's `resume` already handles session continuity at the LLM level, and citation markers seem designed to be per-turn.
- [ ] Add comment header to `write-config.ts` explaining `writeConfig` (validated, wholesale replace, for `mcp_servers`/`registry`) vs `writeConfigDoc` (raw YAML mutation, for `llm`/`onboarding`/future blocks). Two-line table.
- [ ] `loadDotEnvFile` triple-loading. Idempotent so harmless, but called from `boot.ts:71`, `loader.ts:46`, `runQuery.ts:29`. Collapse to one canonical load point per entry path.
- [ ] `resolveConfigPath()` per-request re-evaluation. Server resolves config path on every search request, picking up `XDG_CONFIG_HOME` changes between requests. Probably unintentional. Resolve once at boot OR document the live-edit semantics.

### Future thread — registry auto-population from SQLite (NOT this PR-batch)

The SQLite `sessions` table currently stores per-search turns + sources. The longer-term plan is to use this to **auto-populate the registry** (people, projects) — as a user searches, scry observes which names and projects show up in cited sources, and offers to add them to the registry without hand-editing. This was the original "extend the database for people and projects" thought from kickoff that hasn't been built yet.

Don't accidentally simplify the storage layer in a way that closes this door. Specifically: keep `SessionsStore` flexible enough to grow new tables; don't aggressively prune what looks like unused metadata if it might support future auto-extraction (e.g., `SourceCard.author` is consumed today only by display, but is exactly the kind of signal an auto-registry would mine).

### Architecture observations (no action — FYI)

- The "engine pivot" wrapper (`runQuery.ts`) carries real weight: abort bridging, per-tool source attribution via `toolUseMap`, dual-path finalization, fanout-mode injection. **Don't try to inline this back into the route.**
- `validateMarkers` / progress citation events are vestigial in production but cheap to compute. Tied to the Tier 3 "drop citation event" decision — keep them if we revive progressive highlighting; drop them otherwise.
- `CURRENT_SCHEMA_VERSION = 1` in `storage/sessions.ts` is migration scaffolding without migrations. Leave for when needed (consistent with the auto-registry thread above).
- `WELL_KNOWN_ENV_REFS` only affects the onboarding UI's "detected" badge. Doesn't affect search behavior.
- `scanPathForServers` is only called from `scry init` CLI; the server uses `BUNDLED_SERVERS` directly via `mcps-discover.ts`. Both paths are alive — leave alone.

## What got pushed today

| PR | Title | Status |
|----|-------|--------|
| #23 | fix(test): stub config + poll for persistence in search.test.ts | merged |
| #24 | fix(engine): use tools:[] to disable built-in tools (#5) | merged |

Both green on CI, both squash-merged.

## Learnings

- **Trust CI more than local.** PR #22 had been failing 100% of CI runs since merge, and I didn't notice for ~24 hours because everything passed locally. The CI alarm is the load-bearing signal; the "local passes" is supporting evidence at best. After PR #22 merged with red CI, this should have been the first thing I noticed in the next session, not the third.
- **Test isolation discipline.** `tests/server/routes/search.test.ts` was implicitly relying on `~/.config/scry/scry.config.yaml` existing on the test machine. macOS-specific success was hiding a real isolation bug. **Rule: any backend test that touches a route which calls `resolveConfigPath` must seed `SCRY_CONFIG` to a known stub path in `beforeAll`.** Adding to project conventions.
- **`allowedTools` vs `tools` is a documented trap.** The SDK's d.ts has the warning right there: "To restrict which tools are available, use the `tools` option instead." The original Plan B implementation read past it. Cost was minor (3 wasted Agent calls per query) but the right fix took 30 minutes once spotted. **General lesson: when a config option seems oddly permissive, re-read the type docs — the API often has a stricter sibling.**
- **Adversarial review while CI runs is a free win.** Spawning the repo-review agent in parallel with CI for PR #24 used the wait window productively. Output became this session note.
- **The 35/35 clean baseline on the synthesis eval was real but vacuous.** Avi's framing in this session — "we let user-reported bugs drive fixture creation" — is the right epistemic stance. The eval framework existed before there was a real signal to measure; that's fine, but the framework's value is zero until we add fixtures from real bugs. Don't pre-build fixtures that pattern-match what we *think* could go wrong; wait for evidence.
- **Repo reviews need a "won't recommend" section.** The review explicitly listed things NOT to touch (don't refactor `runQuery.ts`, don't introduce a manager layer, don't bump CI Node yet). This stops downstream work from being "everything the review surfaced" — it should be "everything the review surfaced AND wasn't ruled out."
- **Vestigial code is forensic evidence.** Plan A residue in `src/config/types.ts` tells the story of the engine pivot more clearly than any retrospective. Delete it once we've extracted the lesson, but read the file first.

## Tags

`#scry` `#cleanup` `#repo-review` `#issue-5` `#ci-fix` `#agent-sdk` `#evals`
