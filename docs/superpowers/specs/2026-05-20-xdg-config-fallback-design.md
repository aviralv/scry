# XDG-standard config-path fallback

**Issue:** [#1 — Add XDG-standard config path fallback so scry runs from anywhere](../../issues/2026-05-19-xdg-config-fallback.md)
**Date:** 2026-05-20
**Status:** Approved, ready for implementation plan

## Problem

`scry "<query>"` only works from a directory that contains `scry.config.yaml` (or one with `SCRY_CONFIG` exported). Since scry is published as a global npm CLI (`@aviralv/scry`), users who install it globally hit `Config not found: <CWD>/scry.config.yaml` from every directory except the one their config lives in. The de-facto workaround is to add `export SCRY_CONFIG=...` to a shell rc file — shell surgery to compensate for a CLI defect.

## Goal

`scry "<query>"` works from any directory after a global install + a one-time `mkdir -p ~/.config/scry && cp scry.config.yaml ~/.config/scry/`. No shell-rc changes required.

## Design

### Resolution chain

`resolveConfigPath(explicit?: string): string` returns the first path that matches:

1. `explicit` arg (from `-c, --config`) → `resolve(explicit)`
2. `process.env.SCRY_CONFIG` → `resolve(env)`
3. `./scry.config.yaml` if it exists in CWD
4. `$XDG_CONFIG_HOME/scry/scry.config.yaml`, defaulting to `~/.config/scry/scry.config.yaml` — returned as the fall-through whether or not it exists; the caller surfaces "not found" with a clear error.

CWD beats XDG: strictly additive over current behavior, matches eslint/prettier/vitest conventions, zero risk of breaking the existing `Playground/scry/` dev workflow.

### Code changes

**`src/config/loader.ts`** — add `resolveConfigPath` (exported), call it from `loadConfig`:

```ts
export function resolveConfigPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.SCRY_CONFIG) return resolve(process.env.SCRY_CONFIG);

  const cwdPath = resolve('scry.config.yaml');
  if (existsSync(cwdPath)) return cwdPath;

  // Treat empty string the same as unset — `??` only catches null/undefined.
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
    ? process.env.XDG_CONFIG_HOME
    : join(homedir(), '.config');
  return resolve(xdgConfigHome, 'scry', 'scry.config.yaml');
}

export function loadConfig(path?: string): ScryConfig {
  const configPath = resolveConfigPath(path);
  loadDotEnvFile(join(dirname(configPath), '.scry.env'));
  // ... rest unchanged
}
```

`.scry.env` co-location is unchanged — `dirname(configPath)` already drives it, so it follows the resolved config wherever it lands (including `~/.config/scry/.scry.env`).

**`src/cli.ts`** — three edits:

1. **Drop the commander default for `-c, --config`** (currently `'scry.config.yaml'`). With the default present, `opts.config` is always truthy and short-circuits the XDG fallback. Change `option('-c, --config <path>', 'Config file path', 'scry.config.yaml')` → `option('-c, --config <path>', 'Config file path')`. Update help text to note the resolution chain.
2. **Replace inline resolution at both call sites** (`cli.ts:34` and `cli.ts:121`) with `const configPath = resolveConfigPath(opts.config)`. The `config show` command currently has no `-c` flag — add one for consistency, since both other entry points accept it.
3. **Expand the "not found" error** so users know where to put the file. `resolveConfigPath` returns a single path (the resolved one), so the error wording describes the chain rather than enumerating each attempted path:
   ```
   Config not found at <resolved-path>.
   Scry looks for: -c <path>, then $SCRY_CONFIG, then ./scry.config.yaml,
   then ~/.config/scry/scry.config.yaml.
   Run `scry init` to create one, or copy your existing config to ~/.config/scry/.
   ```

### Tests — `tests/config/loader.test.ts`

New `describe('resolveConfigPath')` block. Use `vi.spyOn(process, 'cwd')` for CWD and either `vi.spyOn(os, 'homedir')` or override `process.env.XDG_CONFIG_HOME` to point at a temp dir; restore in `afterEach`. The helper reads `homedir()` (not `process.env.HOME`), so spy on `os.homedir` rather than mutating `HOME`. Cases:

1. Explicit path arg wins over env, CWD, XDG
2. `SCRY_CONFIG` env var beats CWD and XDG
3. CWD `scry.config.yaml` beats XDG when both exist
4. Falls through to `~/.config/scry/scry.config.yaml` when no path arg, no env var, no CWD config
5. Honors `XDG_CONFIG_HOME` when set
6. Treats `XDG_CONFIG_HOME=""` (empty string) the same as unset — falls back to `homedir()/.config`
7. `.scry.env` next to the resolved config loads (one test via the XDG path branch — existing `dotenv.test.ts` already covers the loading mechanism)

Existing tests in `loadConfig` unchanged.

## Acceptance criteria

- `scry "test query"` works from any directory after `npm i -g @aviralv/scry` + `mkdir -p ~/.config/scry && cp scry.config.yaml ~/.config/scry/`.
- Running from inside `Playground/scry/` continues to work unchanged.
- `scry config show` accepts `-c, --config`.
- "Config not found" error describes the resolution chain.
- README has a "Configuration" section documenting the resolution chain.
- New tests pass; existing tests unchanged.
- Version bumped 0.1.2 → 0.1.3 (additive, no breaking changes).

## Out of scope

- `scry init` defaulting `-d` to `~/.config/scry`. Existing `-d` flag covers the case; doc it in the README.
- Outlook source tool name fix (`Unknown tool: outlook_list_messages`) — unrelated config issue, separate ticket.
- Stale `version('0.1.0')` string at `cli.ts:22` (package.json is 0.1.2). Pre-existing, not in this change.

## Deployment

Per `the-product-kitchen/.claude/rules/DEPLOYMENT.md`: branch `feat/xdg-config-fallback`, install from branch tarball (`npm pack` → `npm i -g <tarball>`), verify in a live session from a non-scry directory before merge to `main`. No auto-publish to npm — wait for explicit Avi sign-off.
