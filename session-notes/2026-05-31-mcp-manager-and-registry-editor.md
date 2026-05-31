# 2026-05-31 — scry: Plan E (MCP manager) + Plan F (Registry editor) + UX iterations

## Theme

Two PRs in one day, both shipped to main. Plan E built the MCP-manager surface plus the shared config-write infrastructure (zod schemas, `writeConfig` with `proper-lockfile`, path-scoped `ApiErrorBody` shape, react-router-dom). Plan F (Registry editor) reused all of that infrastructure, then went through three rounds of UX iteration after smoke testing. Final form is a true table layout — one `<tr>` per entry, columns per field, per-row chevron for secondary fields. Branch-merge-pull cycle with PR #12 (E) and PR #13 (F).

## What got built

### Plan E — MCP manager (PR #12, merged 2026-05-31 09:50Z)

**Shared infra (also feeds Plan F):**
- `src/config/schema.ts` — zod for `McpServerConfig`, `Person`, `Project`, `Registry`, `McpServersMapSchema`. Single source of truth, server + browser side.
- `src/config/write-config.ts` — `writeConfig(path, updates)` with cross-process file lock via `proper-lockfile`. Validates with zod, then mutates the YAML `Document` in place (preserves comments outside the mutated block), then atomic write through existing `atomicWriteConfig`. Throws `ConfigMissingError` (412) and `ConfigValidationError` (400, with path-scoped issues).
- `src/shared/api-errors.ts` — `ApiErrorBody { error, message?, errors? }`. `ApiCallError.message` formats `errors[]` into a readable string when no `message` set.
- Status-code conventions locked: 400 invalid body, 404 missing entity, 409 true conflict (name-exists), 412 config-required (uniformly on GET and PUT), 422 health-check-failed, 204 idempotent DELETE.

**MCP route (`/api/mcps`):**
- GET / POST / PATCH / DELETE / `:name/test`. POST + PATCH gate on `healthCheck` before `writeConfig`.
- `mcp-health.ts` is the security boundary: detached `spawn({ detached: true })` so child has its own PGID via `setsid()`, on timeout `process.kill(-pgid, 'SIGTERM')` then SIGKILL after 200ms grace, env passed to child = `{ PATH, HOME, ...resolveDeclaredEnv(entry.env) }` — no `process.env` spread. `${REF}` resolves only if `REF` is a key declared in the same entry's env block. ENOENT (bad command) lands in `errorPromise`, never crashes the server.

**Web surface:**
- `react-router-dom` v6 added to web/. App.tsx wraps in `<BrowserRouter>`. Sidebar gains `Search · MCPs` nav header above "+ New search."
- `McpManager` route — table of MCP servers (name, command, args, status, enabled, actions), `+ Add MCP` modal (also reused for Edit), per-row Test button, optimistic Delete with restore-on-error.
- `McpAddModal` — form lifecycle: fields disabled during health-check, 422 keeps modal open with inline error, env values UI-validated as `${UPPER_NAME}` only.
- jsdom + @testing-library/react + a separate `web/vitest.config.ts` set up here (Plan F reuses).

**Tests:** 11 schema + 6 writeConfig (incl. concurrent serialization + comment preservation) + 10 health-check (incl. ENOENT-no-crash + env-allowlist value semantics) + 14 mcps route + 5 CSRF + 5 modal + 5 manager.

**Bugs caught in review:**
- T4 critical: ENOENT (bad command) crashed `scry serve` via unhandled async `error` event — moved listener registration before the `pid==null` check, lands in `errorPromise`. `readJsonResponse` listener leaks (`error` and `end` not removed on resolve) plugged.
- T5: `zodToApiErrors` widened to `PropertyKey[]` (zod v4 actual signature) so the two route-side casts dropped.
- T1: `Person` interface was missing `aliases?` even though `PersonSchema` declared it; aligned.
- Smoke iteration after manual test: `.scry.env` not loaded at boot → health-check resolved declared `${REF}` against an empty `process.env`. Fixed in `boot.ts` (loadDotEnvFile once at startServer).
- Smoke iteration: stale repo-root `scry.config.yaml` shadowed `~/.config/scry/scry.config.yaml` because `loader.ts`'s cwd-precedence rule found it first. Moved aside; followup filed.

### Plan F — Registry editor (PR #13, merged 2026-05-31 12:11Z)

**Server route (`/api/registry`):**
- GET → 200 with `{ registry }` (or empty `{ people:{}, projects:{} }` when block absent), or 412 if no config.
- PUT → 200 with saved registry, or 400 with path-scoped `errors[]`, or 412.
- Reuses `RegistrySchema` + `writeConfig` from E. Comments outside `registry:` block survive byte-for-byte (golden test).

**Web surface (after three UX iterations):**

Initial design was per-entry forms expanded by chevron click — one column running down the page with full-width inputs and floating labels. Avi's feedback after smoke: "So much wasted space. Why aren't we using tables?" Converted to true table layout:
- People columns: `key | Name | Role | Teams | Delete`
- Project columns: `key | Name | Aliases | Slack channels | People | Delete`
- Per-row `▸/▾` chevron in the key column reveals a sub-row underneath for secondary fields (Person: aliases, projects, identifiers; Project: jira_project, confluence_cql).
- `ChipsInput` got a `hideLabel` prop — column header carries the visual label, `<label>` becomes `sr-only` for screen readers.

**Working-copy state machine:**
- Four state slots: `server` (last-saved snapshot), `working` (editable copy), `dirty: Set<string>` (deep-equal-derived, computed via `useMemo`), `saveErrors` (path-scoped errors from most recent failed PUT).
- Single Save → PUTs whole working copy. On 200: replaces both server and working. On 400: populates `saveErrors`, leaves `working` and `dirty` alone.
- Discard → confirm → `working = server`, clear `saveErrors`.
- Tabs URL-synced via `useSearchParams` (`?tab=people` / `?tab=projects`).
- Newly-added rows mount with secondary fields auto-open (so identifiers are immediately reachable).
- `useEffect` on `errors` reopens the secondary section when a 400 lands on a secondary field after initial mount.

**Components:** `Registry.tsx` (route), `PersonRow`, `ProjectRow`, `AddRegistryEntryModal` (group-aware, slug-validated key, duplicate check), `ChipsInput` (existing, gained `hideLabel`).

**Bugs caught in review:**
- T8 quality fix: `loadError` not cleared on Save success — stale "save failed" could persist after retry. One-line fix.
- T8 deviation: `aria-label="dirty"` moved from per-row dot (would conflict with delete-then-no-row tests + throw on multiple dirty rows) to page-level "N unsaved changes" span. Visual indicator preserved on rows via `aria-hidden="true"`. Net improvement.
- T5 deviation: modal label "Key (slug)" → "Key" because `getByText` matched both label and error message.

**Smoke iterations after first UI:**
1. Project Add modal showed `andre-c` / `Andre Christ` placeholders — group-aware now (Projects shows `ea` / `Enterprise Architecture`).
2. Newly-added rows were collapsed → user couldn't see email / aliases / identifiers without a click. Auto-open the secondary section for fresh rows.
3. Per-row form layout used screen-width-wide inputs in a single column. Converted to table.
4. `bawa-k teams` label rendering twice (column header + per-row chips label). Added `hideLabel`.

**Tests:** 9 server route + 2 CSRF + golden comment test + 9 ChipsInput + 7 modal + 9 Registry route + 4 lib client = 40 new tests.

## Key Decisions

- **Two specs (E+F) committed up front, but built sequentially.** Spec #1 (E+F-design) was committed at the start; spec #2 (G+H) deferred until E+F shipped. Plan F got its own slimmer spec doc once E proved the patterns. Saved a brainstorm round.
- **Subagent-driven execution with two-stage review per task** — already proven on C2/C3. Caught 4-5 real bugs per plan before merge. ENOENT crash and `aria-label` collision both surfaced in code-quality review.
- **GPT-5 unreachable through proxy** — fell back to GPT-4.1 for adversarial spec review on E. Same workaround as C-series.
- **412 (not 409) for "config doesn't exist"** uniformly on GET and PUT. 409 reserved for true conflicts (name-exists). The frontend never hits a "GET-empty-then-PUT-rejected" UX hole.
- **DELETE idempotent** (204 always). Frontend optimistic-delete depends on it.
- **Per-entry env allowlist is the security boundary, not the schema regex.** Schema validates value shape; runtime resolver in `mcp-health.ts` checks `${REF}` against entry's own declared keys before resolving from `process.env`. Direct unit tests assert the value semantics, not just key presence.
- **Working-copy / single-PUT for Registry, not per-row PUTs.** Atomic write means whole registry is replaced anyway. Per-row PUTs add a partial-write failure mode for zero benefit.
- **Comments inside the registry block are deleted on save.** Honest UI copy: "Comments inside the registry block will be deleted on save. Edit scry.config.yaml directly if you want them preserved." Outside the block survives via `yaml.Document.set` mutation.
- **Table > per-row form** for the registry editor. Form-shaped layout looked like a wizard; table makes a list of entries actually look like a list.

## Files touched (high level)

**Plan E (PR #12):**
- New: `src/config/{schema,write-config}.ts`, `src/server/{mcp-health,routes/mcps,routes/mcps.csrf}.ts`, `src/shared/api-errors.ts`, `web/src/{routes/McpManager,components/{McpRow,McpAddModal},lib/mcps}.tsx`, `web/{vitest.config,vitest.setup}.ts`, `test-fixtures/mcp-fake-{ok,hang,immediate-error,echo-env}.mjs`
- Modified: `src/config/types.ts` (add `enabled?`, `aliases?` to Person), `src/server/{index,boot}.ts`, `src/engine/runQuery.ts` (skip `enabled === false`), `src/shared/types.ts`, `web/src/{App.tsx,components/LibrarySidebar.tsx,lib/api.ts}`, both package.json files (proper-lockfile, react-router-dom, jsdom, @testing-library/react)

**Plan F (PR #13):**
- New: `src/server/routes/{registry,registry.csrf}.ts`, `web/src/{routes/Registry,components/{PersonRow,ProjectRow,ChipsInput,AddRegistryEntryModal},lib/registry}.tsx` + tests
- Modified: `src/server/index.ts`, `src/shared/types.ts` (re-export Registry/Person/Project), `web/src/{App.tsx,components/{LibrarySidebar,ChipsInput}}.tsx`

## Open follow-ups

- **Log resolved config path at `scry serve` boot** — caught during E smoke when stale repo-root config silently shadowed XDG path. Three-line console.log.
- **Carry env-allowlist union into Plan G** — spec acceptance criterion #3 says "union of (a) keys listed in this entry's env block AND (b) the explicit refs forwarded from `.scry.env` for the same MCP." Plan E shipped only (a). Plan G's onboarding wizard auto-writes the env block for bundled MCPs from `bundled-servers.ts` metadata, which closes the user-paste workflow.
- **Persist `lastTestStatus` in sidecar JSON** — currently in-memory only; reload resets all rows to "Never tested." Sidecar JSON at `~/.config/scry/mcp-test-status.json`.
- **`loadServers` (mcps.ts) and `loadRegistry` (registry.ts)** both crash on malformed YAML (no try/catch) and don't shape-guard the parsed result. Fix both at once for consistency. ~5 lines per file.
- **scry config cwd-precedence is a footgun** — useful for dev iteration; surprising in production. Logging the resolved path covers it.

## Next Steps (committed order)

1. **Plan G — Onboarding wizard** (`/onboarding`): 3 steps — auth check → MCP setup with auto-env-block writing for bundled MCPs → write config. The thing that makes scry shareable. Closes the manual-paste workflow we hit during E smoke.
2. **Issue #9 — Markdown rendering in answer panel.** Currently shows `**bold**` literally. Most visible quality gap right now — UI everywhere else is polished, search answers look raw. `react-markdown` with citation-preserving `components` overrides.
3. **Issue #7 — Engine fabricates parenthetical role/affiliation labels** (e.g., `Katja Westphal (PMI)`). System-prompt nudge candidate; needs eval set before tuning.
4. **Plan I — E2E hardening + npm publish bump.** Playwright E2E for the surfaces shipped; npm publish to bump the installed binary.
5. **Plan H — Preferences pane** (`/preferences`): theme toggle, fanout default, read-only env/MCP-detection. Smallest of the four; rounds out the surfaces.

Plan G is the biggest unlock for "anyone else can use this." Issues #9 and #7 are quality gaps in the search experience itself — fixing them before more new surfaces because the search panel is where the actual value lives. Plan I is required before any external sharing. Plan H is a UI affordance that doesn't unblock anything.

## Learnings

- **Plan E's spec assumed React Testing Library was installed.** It wasn't. Added `jsdom` + `@testing-library/react` + a separate `web/vitest.config.ts` mid-plan. Worth checking workspace test setup before specs that depend on it. Cost was ~10 minutes; not a real failure but noting for future.
- **Real-workspace smoke after each major surface keeps catching things specs miss.** E: env-allowlist allowlist-vs-PATH inconsistency, stale config shadowing. F: collapsed-row hides identifiers, single-column form wastes screen, double labels. None of these were findable in tests because the issue is "how it feels to use," not "does the function return the right value." Two-stage subagent review caught code bugs; smoke caught design bugs. Both are necessary.
- **The "table vs form" choice is a real design decision with one right answer.** A list of entries with the same shape is a table. Forms are for one entity at a time. I led with form-shaped rows because "expand to edit" felt cleaner than always-on inputs. Wrong call. Tables are denser and more navigable when the data IS list-shaped.
- **`useState(initial-from-prop)` is a stale-state trap.** PersonRow's `useState(errors.length > 0)` for the auto-expand-on-error feature only ran at mount. Errors arrive after a Save click → mount has long happened → `expanded` stays false. Added `useEffect([errors])` that flips it open. Worth remembering for any component that derives initial state from props.
- **Subagent-driven execution scaled fine for two consecutive plans in one day.** Plan E (13 tasks) and Plan F (9 tasks) both ran cleanly. ~22 implementer dispatches + 12 review dispatches, each with isolated context. The controller-context budget didn't blow up because each subagent got exactly the slice it needed.
- **Squash-merge + delete-branch + pull-main is the cleanest cycle.** Local divergence between commits-on-branch and the squash on main caused a rebase conflict during E→F transition. `git reset --hard origin/main` + cherry-pick the F-spec commit was the right recovery. For the next plan, branch off after the previous PR has been pulled, not before.

## Tags

`#scry` `#mcp-manager` `#registry-editor` `#zod` `#proper-lockfile` `#react-router-dom` `#table-layout` `#working-copy-pattern` `#path-scoped-errors` `#subagent-driven` `#multi-model-review`
