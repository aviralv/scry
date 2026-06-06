# 2026-06-06 (b) — scry: 5-PR cleanup batch executed (PRs B–F)

## Theme

Executed the 5-PR cleanup plan from this morning's [repo review](2026-06-06-repo-review-and-cleanup.md). Each PR shipped, reviewed adversarially by GPT + Gemini in parallel, real findings folded back in before merge. Plus a 6th PR (F) folding the smaller deferred review fixes from PR E. Six merged PRs total: #25 (PR A, this morning), #26-#30 (PRs B-F, this evening). Zero production regressions; backend test count grew 331 → 340.

## What got built

### PR B (#26) — Tier 2 extractions
- `src/config/env-ref.ts` (new) — single source of truth for the canonical `${VAR_NAME}` regex. Replaced 3 independent copies in llm-test.ts, mcp-health.ts, routes/llm.ts. New `ENV_REF_RE` + `isEnvRef()` + `parseEnvRef()` exports. **8 unit tests** locking accept/reject behavior.
- `src/shared/mcp-entry.ts` (new) — `McpServerEntry` + `toMcpEntry()` shared between server routes and web client (was 3 copies). Web now imports the wire-protocol shape via `@shared/types.js`.
- `LlmTestInput` aliases `LlmConfig`. `LlmConfigInput` (web) aliases `LlmConfig`. One canonical shape across server + client.
- **Deleted** `src/config/write-config-pair.ts` + its test entirely. Zero production callers; both intended consumers inline equivalent two-phase logic with `readDoc-inside-lock` semantics the helper couldn't express.
- **Deleted** `InsertSession` from `storage/types.ts`. Identical to `SessionRow` after the `turns` rename.

### PR C (#27) — Tier 3 protocol cleanup
- **Dropped `citation` SSE event** entirely. `RunQueryEvent.citation` variant removed; emission removed from `runQuery.ts`; `validateMarkers` method removed from `SourceTracker`; `case 'citation'` branches removed from `cli/headless.ts` and `web/src/routes/Search.tsx`. Both consumers were no-ops (CLI's `case` was empty; web's reducer returned `prev`). Zero protocol traffic from the now-deleted event.
- **Dropped `raw: unknown`** from `SourceCard`. Field was written but never read; bloated SSE stream and SQLite payload. Existing rows in `scry.db` deserialize cleanly — JSON.parse silently drops the unused key.
- **Dropped `normalizer?: string`** from `SearchToolConfig`. README falsely claimed slack/email/confluence normalizers existed; engine is pure LLM synthesis. Removed from types + bundled-servers. README "How Normalizers Work" section deleted. Existing user configs with `normalizer: "slack"` still parse fine — Zod strips unknown fields.

### PR D (#28) — Tier 4 test gaps
- 2 fanout tests in `runQuery.test.ts`: directive lands when `fanoutMode=true`, doesn't land by default. Initially used loose regex; review caught it (see "Reviews" below); follow-up tightened to `.toContain(FANOUT_DIRECTIVE)` against an exported constant.
- 1 multi-block tool_result test locking the documented "first block wins" behavior.
- 2 fanoutMode tests in `search.test.ts`: schema acceptance + wrong-type rejection. Review caught they didn't actually verify forwarding; follow-up upgraded the runQuery mock to capture opts (`lastRunQueryOpts`) and assert `fanoutMode` reaches the engine.
- 2 boot integration tests for `onboarding-autocomplete` migration: a pre-G config gets migrated; an existing `onboarding` block is NOT silently overwritten.
- New eval fixture `tests/eval/synthesis/fixtures/08-citation-fidelity.yaml` — regression net for "phantom citations" (`[N]` for N > source count). Initial pattern missed `[0]`; review-fix consolidated to single `\[(?:0|[3-9]|[1-9][0-9]+)\]` regex.

### PR E (#29) — Tier 5 decisions
- **Removed `priorSources`** from `RunQueryOptions`. The option was defined and accepted but the route never populated it from storage; SDK's `resume` handles session continuity at the LLM level. Citation markers are per-turn — sources re-emit per follow-up. SourceTracker constructor still accepts `prior` (used by tests); engine now always passes `[]`. Restore from git history if cross-turn citation continuity ever becomes a real feature.
- **Header comment in `write-config.ts`** documenting the two-tier design: `writeConfig` for schema-validated wholesale-replace blocks (mcp_servers, registry); `writeConfigDoc` for raw YAML mutation (llm, onboarding, future blocks). Two-line table inline.
- **Dropped redundant `loadDotEnvFile` call** in `runQuery.ts`. CLI loads via `loadConfig` in headless.ts; server loads at boot AND per-request via `loadConfig`. Engine-layer copy was the third redundant load. Comment now documents who's responsible.
- **Resolve config path once** in `createServer` instead of per-request `() => resolveConfigPath()` thunks. Live `SCRY_CONFIG` env changes between requests no longer take effect (need to restart `scry serve`). Search route resolves its own path per-request, so live config-FILE edits and live `SCRY_CONFIG` still affect search specifically.

### PR F (#30) — review follow-ups
- Route builders take `configPath: string` directly instead of `() => string` thunks. PR E made them wrap a constant; the indirection was carrying its own weight no more. Touched 5 route modules + their test fixtures + `index.ts`.
- `write-config.ts` header phrasing fix: "Schema-validated, full replace, race-safe merge" → "Schema-validated, full replace". The function is a wholesale replace, not a merge; lock-protection is documented separately.
- `runQuery.ts` step numbering inconsistency fixed (PR E renumbered 3→2 etc. but left the first block unnumbered, leaving 2-5 with no 1). Dropped numbers entirely — the comments already describe what each block does.
- `index.ts` comment clarified that the search route resolves its own path per request, so live `SCRY_CONFIG` changes still affect search even after the once-resolution change in PR E.

## Adversarial reviews — what they caught

Each PR was reviewed by GPT (4.1) and Gemini 2.5 Pro in parallel via the Hyperspace proxy.

### Review patterns observed

**False positives from incomplete diff context** — three across the batch. Each surfaced as "Critical: structural mismatch in X" but evaporated on direct verification:
1. **PR B / `InsertSession`** — both models claimed `InsertSession.turns: StoredTurn[]` differed from `SessionRow.turns_json: string`. Verified: identical `turns: StoredTurn[]` shapes; the `turns_json` is the *DB column*, not a TypeScript type.
2. **PR D / `parseToolResult`** — Gemini claimed the multi-block test bypassed `parseToolResult`. Verified: `runQuery.ts:129` calls it on the yielded `tool_result` block.
3. **PR D / regex** — Gemini claimed `\[[1-9][0-9]+\]` doesn't match `[10]`. Verified by running the regex in Node: it matches.

**Real findings, all in PR D and PR E:**
- **PR D** — fanout regex too loose; `[0]` gap in citation fidelity fixture; "accepts fanoutMode" test wasn't actually verifying forwarding. All three fixed in a follow-up commit before merge.
- **PR E** — thunks-around-constant smell; "race-safe merge" phrasing conflates locking with merge semantics; step numbering off-by-one; `runQuery` now silently fails for direct callers if env not pre-loaded (acknowledged in code comment; deemed acceptable given runQuery is internal). Folded into PR F.

**Reviews that returned no signal:**
- PR C — review agent got confused about branch state; partial output.
- PR B — only the false positive.

### Pattern: model overlap ≠ signal

This is the **third independent occurrence** of two adversarial models hallucinating the same critical finding from incomplete context (PR #21's `forbiddenHits`, PR #26's `InsertSession`, PR #28's `parseToolResult`). High overlap between independent reviewers feels like strong signal but is at least sometimes shared inferential weakness — both models reach for the same plausible-but-wrong reading when the diff doesn't show the ground truth.

**Operational rule:** before "fixing" a Critical finding, verify the structural claim by running grep / reading the source. The cost of verification is ~30 seconds; the cost of "fixing" a non-existent bug is real damage to working code.

## Key decisions

- **Branched all 5 cleanup PRs off main, not chained.** Avoided a fan of dependent rebases. Each PR is independently reviewable, mergeable, revertable. Cost: a few merge conflicts when later PRs touched the same files (handled by `git merge origin/main` once).
- **Dispatched reviews in parallel with implementation.** While CI ran on PR B, started PR C; while CI ran on PR C, started PR D; etc. The wait windows were free orchestration time.
- **Folded review fixes back into the same PR before merge** when low-hanging (PR D). Folded into a follow-up PR (F) when they belonged to multiple PRs or were structural enough to deserve their own diff (PR E's findings).
- **Kept the punch-list as a session-note artifact.** Started this morning as `2026-06-06-repo-review-and-cleanup.md`; the cleanup execution is captured here as `2026-06-06b-cleanup-batch-executed.md`. Together they tell the full "review → plan → execute" arc.
- **Held off on the `runQuery` env-loading guard.** PR E review's medium-severity finding ("runQuery silently fails if direct callers don't pre-load env") is acknowledged in a code comment but no runtime guard added. Justified: runQuery is internal (not a public API surface); when scry becomes a published library, revisit.
- **Did NOT pre-build evals beyond fixture 08.** The "let user-reported bugs drive fixture creation" stance from this morning's session note holds. Citation-fidelity is the only new fixture because it catches a *different* failure shape than the affiliation-fabrication ones (under-attribution vs. over-attribution). Multi-turn fixtures deferred until `priorSources` is repopulated or the use case becomes real.

## What got pushed today (cumulative)

| PR | Title | Status |
|----|-------|--------|
| #23 | fix(test): poll for SSE-persisted row in search.test.ts | merged (this morning) |
| #24 | fix(engine): use tools:[] to disable built-in tools (#5) | merged (this morning) |
| #25 | cleanup: PR A — Tier 1 deletions | merged (this morning) |
| #26 | cleanup: PR B — Tier 2 extractions and consolidations | merged |
| #27 | cleanup: PR C — Tier 3 protocol + payload cleanup | merged |
| #28 | cleanup: PR D — Tier 4 test + eval gaps from repo review | merged |
| #29 | cleanup: PR E — Tier 5 decisions from repo review | merged |
| #30 | cleanup: PR F — review follow-ups from PR E | merged |

8 PRs merged in one day. Main CI green throughout.

## Test counts on main

- Backend: **340** (was 331 at start of day)
- Web: **122** (unchanged)
- E2E: **8** (unchanged)
- Eval fixtures: **8** (was 7; +1 citation-fidelity)

## Learnings

- **Branching off main beat chaining for parallel cleanup PRs.** Considered dependency-ordering (B depends on A, etc.) but in this case each cleanup was independently scoped. The few merge conflicts when files overlapped (PR E touched things PR C also touched) were trivially resolvable. The alternative — chaining — would have meant rebasing each subsequent PR every time an earlier one merged. Wrong tradeoff for parallel-friendly work.
- **Adversarial review value is in the 1-2 real findings per PR, not the breadth.** Today's reviews surfaced ~10 findings total across 5 PRs; ~6 were real (3 false positives + ~5 over-broad / non-actionable). Real-finding rate ~50-60%. That's still positive — the cost of running the reviews in parallel during CI waits was zero, and the real findings genuinely improved 2 PRs (D's regex tightness, E's thunk indirection). But don't trust "Critical" labels without verification.
- **The cumulative model-hallucination pattern is now a documented rule, not a one-off.** Three occurrences in two days. When a reviewer flags "structural mismatch X" or "removed Y is still referenced at Z", the verification cost is one grep. Don't trust a Critical finding without that grep — and especially don't trust two independent models agreeing on it. Hallucination overlap exists.
- **Comment touch-ups stack up.** Today's "renumbering accidents," "phrasing-conflated-locking-with-merge," "thunks-over-constants" findings all came from prior PRs (E and earlier). The reviews are catching small accumulated drift, not fresh bugs. Worth running a sweep periodically rather than waiting for a review to surface them.
- **Following up on review findings in a separate PR (F) was cleaner than amending.** PR E's review came back AFTER it merged. Amending wasn't an option; folding follow-ups into a new PR with explicit attribution to the prior PR's review made the change traceable and reviewable on its own merits.

## Tags

`#scry` `#cleanup` `#repo-review` `#5-pr-batch` `#adversarial-review` `#model-hallucination` `#patterns`
