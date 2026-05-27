# 2026-05-25 — Plan B: engine pivot to Claude Agent SDK

## Theme

Replaced the homegrown "deterministic fanout" engine with `@anthropic-ai/claude-agent-sdk`. The probe that triggered this: scry's planner was just `always-call-all + per-source query templates` plus a synthesizer. Claude could do all of that natively, with better entity recognition and disagreement handling. Keeping the registry, fanout option, and source attribution; dropping the planner/normalizer/synthesizer/mcp-pool plumbing.

## What got built

### New engine surface (`src/engine/`)

- `runQuery.ts` — async generator wrapping the SDK's `query()`. Walks SDK message types (`system+init` → `session-init`, `assistant.content[]` → `assistant-text` / `tool-call`, `user.content[]` → `tool-result`, `result` → `done`). Correlates `tool_use_id` → `{ tool, server }` so each `tool_result` attributes to the right source.
- `source-tracker.ts` — session-scoped `[N]` assignment + `validateMarkers(text)` for inline citations. Monotonic across a session (changed in C2 to per-turn).
- `system-prompt.ts` — identity + registry context + output rules + optional fanout directive. Built dynamically from config.
- `types.ts` — `RunQueryOptions`, `RunQueryEvent` discriminated union, `SourceCard`, `Citation`.

### CLI

- `src/cli/headless.ts` — `scry "<query>"` flows through `runQuery`. Prints Claude's prose as-is (Sources block stays inline since users read it in the terminal). Switch over `RunQueryEvent` variants with explicit no-op cases for events the CLI doesn't surface.

### Deleted (old engine)

`src/core/{planner,mcp-pool,normalizer,synthesizer,registry,detector}.ts` and tests. `src/index.ts` (the old library API surface) — no longer needed since downstream just calls `runQuery`.

## Bugs hit during live test

1. **Every tool call returned `permission denied`.** The SDK runs in a Claude Code permission model; headless flow has no UI to approve prompts. Fix: `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` + an `allowedTools: [mcp__server__tool, ...]` allowlist derived from `config.search_tools`. The bypass is scope-bounded by the allowlist, not unconditional.
2. **MCP `tool_result` content is array-form**, not a JSON string. Each block is `{ type: 'text', text: string }`. Multi-block results joined naively into invalid JSON. Fix: take the first text block only — paginate via tool args if more is needed.
3. **Source-tracker rendering "untitled" / "tool result"** because most MCPs return markdown, not JSON-shaped payloads. Fix in this plan: drop the redundant `Sources:` block scry was emitting and lean on Claude's own enumeration in the prose. Structured rail deferred to C1's `parse-sources` rework.
4. **Version mismatch** — `cli.ts` had `0.1.3` but `package.json` was `0.2.0`. Fixed during this plan.
5. **Stale `types: ./dist/index.d.ts`** in `package.json` after `src/index.ts` deletion. Removed.
6. **`process.on('SIGINT')` accumulates handlers** if `runQuery` is called multiple times. Fixed with `process.once` + explicit `removeListener` in the finally path.
7. **`(err as Error).message` could throw on `null`.** Switched to `err instanceof Error ? err.message : String(err)` everywhere.

## Key Decisions

- **`cwd` locked to `<scryConfigDir>/`** (e.g. `~/.config/scry/`). The SDK persists session JSONLs at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` — keeping `cwd` stable means follow-up turns find their prior conversation. Passed explicitly per query; never `process.chdir`.
- **`allowedTools` derived from config** — `mcp__<server>__<tool>` for every entry in `search_tools`. Built-ins (`Read`, `Bash`, `Edit`, `Task`, etc.) stay blocked even with `bypassPermissions`. This is what prevents scry from accidentally reading the user's vault despite filesystem-adjacent OneDrive paths showing up in MCP results.
- **`fanoutMode` becomes a system-prompt directive** instead of a planner-level flag. Default off (Claude picks tools); on (Claude must call all configured tools first turn before any prose).
- **CLI keeps Claude's prose verbatim.** The terminal reader sees the same enumeration the GUI parses. No separate rail.
- **No retry loops, no fallback.** If the SDK fails, we yield an `error` event and stop. Matches C1/C2/C3 contract for stream consumers.

## Files touched

### Created
- `src/engine/{runQuery,source-tracker,system-prompt,types}.ts` + tests
- `src/cli/headless.ts` (replaces the old `cli.ts` query path)

### Modified
- `src/cli/index.ts` — registers the new `query` and `serve` subcommands
- `package.json` — bumped to 0.2.0, removed `types` field
- `README.md` — engine pivot section

### Deleted
- `src/core/{planner,mcp-pool,normalizer,synthesizer,registry,detector}.ts` and the matching test directories
- `src/index.ts` (old library surface)

## Open follow-ups (filed at this point)

- Source-tracker rework — parse Claude's prose enumeration (a `Sources:` block) into structured cards. Folded into C1 as task T1 (`parse-sources.ts`).

## Next Steps

1. Plan C — three-checkpoint search route rollout. C1: search route + UI. C2: in-page follow-up. C3: library sidebar + SQLite.

## Learnings

- **The "deterministic fanout" idea was a fiction once probed.** Pre-pivot, scry was making Claude-shaped decisions (which tools, what queries, how to synthesize) with hand-rolled string-templating + best-effort normalization. The honest version was: "let Claude do this, with constraints." The pivot cut ~600 lines and made the engine more capable.
- **Permission model gotchas eat half a day if you don't read SDK source.** The bypass + allowedTools combination is documented but not obvious — the failure mode is silent ("permission denied") in tool results, which looks like a tool config bug.
- **Cwd-locking is the linchpin.** Without it, every restart of `scry serve` would invalidate the SDK's session JSONLs and break C2's resume + C3's library. Worth setting once and never changing.

## Tags
`#scry` `#claude-agent-sdk` `#mcp` `#engine-pivot` `#permissions` `#session-resume`
