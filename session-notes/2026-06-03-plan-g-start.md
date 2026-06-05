# 2026-06-03 — scry: Plan G start (Tasks 1–4.5 + concurrency fix)

## Theme

Started Plan G (onboarding wizard) execution after spending most of the day on spec + plan + adversarial review. Got 4 of 20 tasks shipped on a feature branch plus an inserted Task 4.5 (concurrency fix) prompted by code review. Two real incidents during execution surfaced lessons about subagent-driven dev that are worth remembering. Pausing mid-Task 5; PR not yet open.

## What got shipped (branch `feat/onboarding-wizard-g`, 8 commits)

**Plan G design + plan (committed earlier on `main`):**
- Spec: `docs/superpowers/specs/2026-06-02-onboarding-wizard-g-design.md` (passed GPT-4.1 + Gemini 2.5 Pro adversarial pass; 7 spec changes applied; SSRF allowlist, two-phase write, McpAddModal callback contract, server-startup migration, skip-flag clearing, RequireOnboarding visibility refresh, multi-line value rejection).
- Plan: `docs/superpowers/plans/2026-06-03-onboarding-wizard-g-plan.md` (20 tasks, ~4700 lines, TDD shape mirroring Plans E/F).

**Implementation (branch only, not yet PR'd):**

- **Task 1 — `BundledServer.slug` field** (`89cfc3d`). Canonical slug per bundled MCP. Slack entry gained missing `envVars: ['SLACK_TOKEN']`. `path-scan.ts` switched from regex derivation to direct `s.slug` field. Three new tests.
- **Task 2 — `LlmConfigSchema` + `OnboardingSchema`** (`13be468`). Zod for the `llm:` block (with optional `auth_token` for proxy case) and `onboarding:` block (with skip flags). `LlmConfig.auth_token` made optional to align. 8 new schema tests.
- **Reverted phantom Task 2 fix** (`8ff7195`). See Lesson #1 below.
- **Task 3 — `writeDotEnv`** (`cbe8d54` + `8428134` for `\r` follow-up). Idempotent merge into `.scry.env`, comment-preserving for unchanged keys, file-locked, multi-line-rejected (`\n` and `\r`), uses existing `atomicWriteConfig`. 11 tests.
- **Task 4 — `writeConfigAndEnv`** (`4ebdc30`). Two-phase atomic write across config + .scry.env. Validates both sides synchronously before any I/O. Implementer caught a design inconsistency in my plan (env-first ordering would have failed test #2 because env writes before config validation runs); they extracted `validateConfigUpdates` as an exported pure function so both sides validate before any write. 5 new tests.
- **Task 4.5 (inserted) — `writeConfig` callback API + concurrency fix** (`b269a7d` + `216e48c`). Fixed a race that pre-existed in Plan E and would have hit Plan G's wizard hard. See Discovery #2 below. New `writeConfig(path, merge: (current: ScryConfig) => updates)` shape; merge runs INSIDE the lock. All 6 call sites converted (mcps.ts POST/PATCH/DELETE, registry.ts PUT, write-config-pair.ts pass-through). New `ConfigNameExistsError` and `ConfigNotFoundError` typed classes. Concurrent-write tests now assert both writes persist.

**Baseline:** 226/226 backend tests, 42/42 web, `tsc --noEmit` clean.

## Lesson #1: Stale untracked files in OneDrive working tree corrupted reviewer signal

**What happened.** During Task 2 spec review, the reviewer ran `npx tsc --noEmit` and reported a `TS2769` error in `src/core/synthesizer.ts` — a file I'd renamed `LlmConfig.auth_token` to optional, but synthesizer was passing it unconditionally to a headers object. Reviewer flagged it as a defect; implementer "fixed" it by adding 197 lines back into `src/core/synthesizer.ts` and `tests/core/synthesizer.test.ts`.

The problem: **`src/core/` was deleted from the repo in `1191e18` (May 24, 2026)** as part of "delete old src/core/ engine; superseded by src/engine/." The current production engine is `src/engine/runQuery.ts`, which uses `@anthropic-ai/claude-agent-sdk` and reads auth from environment variables — it doesn't read `config.llm.auth_token` at all.

The "defect" the reviewer found was in **stale untracked files** that have been polluting my OneDrive working tree since before this session (they show up in `git status --short` as `?? src/cli.ts`, `?? src/core/`, `?? src/index.ts`, `?? tests/core/`). The reviewer's `tsc --noEmit` was typechecking these zombie files alongside live code. The implementer compounded the error by re-tracking them, accidentally re-adding deprecated code as a "fix."

**Recovery.** Reverted `26587d4`. Quarantined all stale untracked files to `~/Desktop/scry-stale-quarantine-2026-06-03/`. Working tree now only has `.claude/` (project agent config) and `.scry.env` (secrets) untracked — both intentional. Baseline test count corrected from "phantom 258" down to actual 210, then climbed cleanly through 219 (Task 3) → 226 (Tasks 4 + 4.5).

**Lessons:**

1. **Pre-flight should include working-tree cleanliness check.** Before dispatching subagents, `git status --short` should show only intentionally-untracked paths. Anything else is a foot-gun.
2. **Spec/code reviewers must verify file is tracked before treating it as production code.** Added `git ls-files <path>` guidance to every reviewer prompt going forward.
3. **OneDrive's "files-on-demand" sync surfaces ghosts.** Files that were deleted in the repo can sit forever as untracked locals. The pattern is hostile in a multi-agent execution context where each subagent is fresh and treats whatever it reads as authoritative.
4. **The implementer's "alignment" instinct was good but not enough.** They correctly noticed the type mismatch, but didn't ask "should this file even exist?" before patching it. A `git ls-files` check would have caught it — and that's now in the prompt template.

**Cost:** ~30 min of churn, plus reverting one bad commit. Could have been catastrophic if the resurrected file had been committed and pulled into Plan G's later tasks.

## Discovery #2: `writeConfig` had a pre-existing race that Plan G would have hit hard

**What happened.** Code review on Task 4 (`writeConfigAndEnv`) flagged that the concurrent-test name (`'serializes concurrent calls via the file lock'`) only checked env, not config. I dug in and confirmed: **`writeConfig` does wholesale-replace of `mcp_servers` and `registry`** — and the read-modify-write that callers do (Plan E's `loadServers` then `writeConfig({ mcp_servers: { ...servers, [name]: newServer } })`) reads OUTSIDE the lock.

Two concurrent POSTs to `/api/mcps` race: each reads its own snapshot, each computes its own merged map, each wholesale-writes. **Last write wins; the loser's update is silently dropped.**

Plan E's manager UI doesn't trigger this (one button → one POST). But Plan G's wizard Step 2 fires N parallel `addOnboardingMcp` calls per picked card. Without a fix, **only one of N picked MCPs would have persisted** — and we wouldn't have noticed in unit tests because the existing concurrent test only checked env.

**Fix (Task 4.5, inserted between planned Task 4 and Task 5):**

Refactored `writeConfig` from `(path, updates)` to `(path, merge: (current: ScryConfig) => updates)`. The merge callback runs INSIDE the lock, after a fresh `readFile + parseDocument + toJSON`. Each writer's update is computed against the just-written state of the previous writer.

All 6 call sites (mcps POST/PATCH/DELETE, registry PUT, write-config-pair pass-through) converted. Added `ConfigNameExistsError` + `ConfigNotFoundError` typed classes for inside-lock conflict signaling. Updated tests to actually assert both writes persist after `Promise.all([w1, w2])`.

**Validation behavior trade-off documented:** Config validation now runs inside the lock (it can't run before — it depends on the merge callback's output), so a config-validation failure leaves env already written. The wizard's caller-side Zod validation will catch most failures upfront; the residual (a hand-edited config that violates some edge constraint) leaves a recoverable env state with a missing config reference. Test made the trade-off executable.

**Lessons:**

1. **Pre-existing bugs surface when usage patterns change.** Plan E shipped fine because the manager UI is single-shot. The concurrency hazard was latent until Plan G's parallel wizard usage. This is exactly the kind of bug that adversarial spec review *can't* catch — it requires actually thinking about the API's concurrency contract.
2. **Read-outside-lock is a smell anywhere in a read-modify-write.** Whenever I see "load X, mutate, write X" in route handlers, the load and mutate must be inside the lock that protects the write.
3. **Test names that overclaim are worse than missing tests.** "serializes concurrent calls" suggested correctness was being verified; the test passing without a config assertion gave false confidence. The fix made the assertion explicit so future readers see what's actually verified.
4. **Catching this NOW was 1 task of work; catching it during smoke testing in Task 19 would have been much harder to debug.** The two-stage review (spec compliance + code quality) earned its keep.

## Mid-execution observations on subagent-driven dev

Beyond the two big incidents:

- **The implementer's "DONE_WITH_CONCERNS" pattern surfaces the right things.** Both Task 2's auth_token-optional alignment and Task 4's validateConfigUpdates extraction were flagged by the implementer as deviations from the plan. In both cases the deviation was correct and made the implementation better. Without explicit DONE_WITH_CONCERNS surfacing, I'd have to trust the diff alone.
- **Spec compliance review caught a real defect (Task 2's tsc error).** The fact that it was a phantom doesn't change that the mechanism worked — it surfaced a discrepancy between asserted and actual state.
- **Code quality review caught the misnamed concurrent test on Task 4.** Spec review had passed it as compliant; code review caught the over-claiming title and pushed me into the actual race fix. Two stages aren't redundant.
- **Each task burns ~50–80k subagent tokens** including the two reviews. Total so far: ~500k for 4 tasks. Remaining 16 tasks at this rate: ~2M. The fix-loops on Tasks 2, 3, 4 added overhead; cleaner tasks should be cheaper.

## What's still on the branch

- 8 commits beyond `main`: Task 1 (slug), Task 2 (schemas), revert (phantom fix), Task 3 (writeDotEnv), Task 3 \r fix, Task 4 (writeConfigAndEnv), Task 4.5 (writeConfig callback), Task 4.5 follow-up (typed errors).
- `.gitignore` was updated on `main` (`60408be`) to ignore `.superpowers/` brainstorming-companion artifacts. Fold into a future PR.
- Stale-quarantine directory at `~/Desktop/scry-stale-quarantine-2026-06-03/` holds the zombie `src/core/` etc. files. Can probably delete after smoke-testing the branch confirms nothing depends on them.

## Resume point

Branch `feat/onboarding-wizard-g`, ready to dispatch **Task 5 — SSRF allowlist (`isAllowedBaseUrl`)**. Plan section in `docs/superpowers/plans/2026-06-03-onboarding-wizard-g-plan.md`. Subagent-driven execution context is fresh per task — only thing I need to carry forward is the tracked-file warning + the cleaned working tree.

Remaining tasks: 5 (SSRF) → 6 (`runLlmTest`) → 7 (startup migration) → 8 (`/api/llm`) → 9 (`/api/mcps/discover`) → 10 (`/api/onboarding`) → 11–17 (web stack: 3 lib clients + 4 wizard components + RequireOnboarding + Onboarding route) → 18 (App+sidebar+Search+412 wiring) → 19 (smoke + boot bootstrap) → 20 (PR + adversarial review).

Estimate: 16 tasks × ~10–15 min each = ~3 hours of execution time. Could run in one focused session.

## Tags

`#scry` `#plan-g` `#onboarding-wizard` `#subagent-driven` `#concurrency-fix` `#review-loop` `#stale-files` `#onedrive-pollution` `#typed-errors` `#writeConfig`
