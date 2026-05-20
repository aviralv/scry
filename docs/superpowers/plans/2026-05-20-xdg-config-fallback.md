# XDG Config-Path Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scry "<query>"` work from any directory by adding an XDG-standard config-path fallback (`~/.config/scry/scry.config.yaml`) to the resolution chain.

**Architecture:** Extract a single `resolveConfigPath(explicit?)` helper in `src/config/loader.ts` that owns the resolution chain (explicit → `SCRY_CONFIG` → CWD → XDG). Replace inline resolution at the two `cli.ts` call sites. CWD beats XDG, so existing dev workflow inside `Playground/scry/` keeps working unchanged.

**Tech Stack:** TypeScript, Node.js ≥20, vitest, commander, yaml.

---

## File Structure

- **Modify:** `src/config/loader.ts` — add `resolveConfigPath`, refactor `loadConfig` to use it
- **Modify:** `src/cli.ts` — drop commander default, use helper at both sites, expand error message, add `-c` to `config show`
- **Modify:** `tests/config/loader.test.ts` — add `describe('resolveConfigPath')` block + one `loadConfig` test for `.scry.env` co-location via XDG path
- **Modify:** `README.md` — Configuration section documents the resolution chain
- **Modify:** `package.json` — bump version 0.1.2 → 0.1.3

No new files.

---

### Task 1: Create feature branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to the feature branch**

Run from repo root:
```bash
git checkout -b feat/xdg-config-fallback
git status
```

Expected: `On branch feat/xdg-config-fallback` and clean working tree (the spec commits are on `main`; the branch starts from there).

---

### Task 2: Add `resolveConfigPath` helper, test-first

**Files:**
- Test: `tests/config/loader.test.ts` (modify — add new `describe` block)
- Modify: `src/config/loader.ts` (export `resolveConfigPath`)

- [ ] **Step 1: Add the failing tests**

Append to `tests/config/loader.test.ts` (after the existing `describe('loadConfig', ...)` block, before the closing of the file):

```typescript
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as os from 'os';
import { vi } from 'vitest';
import { resolveConfigPath } from '../../src/config/loader.js';

describe('resolveConfigPath', () => {
  let tmpHome: string;
  let tmpCwd: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'scry-home-'));
    tmpCwd = mkdtempSync(join(tmpdir(), 'scry-cwd-'));
    delete process.env.SCRY_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
    vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns explicit path when provided, beating env/CWD/XDG', () => {
    process.env.SCRY_CONFIG = '/from/env.yaml';
    writeFileSync(join(tmpCwd, 'scry.config.yaml'), '');
    expect(resolveConfigPath('/explicit/path.yaml')).toBe('/explicit/path.yaml');
  });

  it('uses SCRY_CONFIG when no explicit arg, beating CWD/XDG', () => {
    process.env.SCRY_CONFIG = '/from/env.yaml';
    writeFileSync(join(tmpCwd, 'scry.config.yaml'), '');
    expect(resolveConfigPath()).toBe('/from/env.yaml');
  });

  it('uses CWD scry.config.yaml when it exists, beating XDG', () => {
    const cwdConfig = join(tmpCwd, 'scry.config.yaml');
    writeFileSync(cwdConfig, '');
    expect(resolveConfigPath()).toBe(cwdConfig);
  });

  it('falls through to ~/.config/scry/scry.config.yaml when nothing else hits', () => {
    expect(resolveConfigPath()).toBe(join(tmpHome, '.config', 'scry', 'scry.config.yaml'));
  });

  it('honors XDG_CONFIG_HOME when set', () => {
    const customXdg = mkdtempSync(join(tmpdir(), 'scry-xdg-'));
    process.env.XDG_CONFIG_HOME = customXdg;
    expect(resolveConfigPath()).toBe(join(customXdg, 'scry', 'scry.config.yaml'));
    rmSync(customXdg, { recursive: true, force: true });
  });

  it('treats XDG_CONFIG_HOME="" the same as unset', () => {
    process.env.XDG_CONFIG_HOME = '';
    expect(resolveConfigPath()).toBe(join(tmpHome, '.config', 'scry', 'scry.config.yaml'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/config/loader.test.ts
```

Expected: vitest reports 6 failing tests in `resolveConfigPath` (and the existing `loadConfig` and `resolveEnvVars` tests still pass). The failures will be import errors — `resolveConfigPath is not a function` or similar.

- [ ] **Step 3: Implement `resolveConfigPath` in `src/config/loader.ts`**

Replace the contents of `src/config/loader.ts` with:

```typescript
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import type { ScryConfig } from './types.js';
import { loadDotEnvFile } from './dotenv.js';

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] ?? '';
  });
}

function resolveDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveDeep(value);
    }
    return result;
  }
  return obj;
}

export function resolveConfigPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.SCRY_CONFIG) return resolve(process.env.SCRY_CONFIG);

  const cwdPath = resolve('scry.config.yaml');
  if (existsSync(cwdPath)) return cwdPath;

  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
    ? process.env.XDG_CONFIG_HOME
    : join(homedir(), '.config');
  return resolve(xdgConfigHome, 'scry', 'scry.config.yaml');
}

export function loadConfig(path?: string): ScryConfig {
  const configPath = resolveConfigPath(path);
  loadDotEnvFile(join(dirname(configPath), '.scry.env'));
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw);
  return resolveDeep(parsed) as ScryConfig;
}
```

Note: `loadConfig` now uses `resolveConfigPath` internally, replacing the previous one-line resolution. Existing `loadConfig` tests (which pass an explicit path) continue to work because the explicit branch returns `resolve(path)` — identical to the previous behavior.

- [ ] **Step 4: Run all tests to confirm everything passes**

```bash
npm test
```

Expected: all tests pass — the 6 new `resolveConfigPath` tests, plus existing `resolveEnvVars`, `loadConfig`, `parseDotEnv`, `loadDotEnvFile`, and `bundled-servers` tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts tests/config/loader.test.ts
git commit -m "feat(loader): add resolveConfigPath with XDG fallback

Resolution chain: explicit -c > SCRY_CONFIG > CWD scry.config.yaml >
\$XDG_CONFIG_HOME/scry/scry.config.yaml (defaults to ~/.config/scry/).

CWD-before-XDG keeps existing dev workflow working unchanged.
Empty XDG_CONFIG_HOME treated as unset."
```

---

### Task 3: Add `.scry.env` co-location test for the XDG branch

**Files:**
- Test: `tests/config/loader.test.ts` (modify — add one test inside `describe('loadConfig', ...)`)

- [ ] **Step 1: Add the test**

Inside the existing `describe('loadConfig', ...)` block (after the existing four `it(...)` cases, before its closing `});`), add:

```typescript
it('loads .scry.env co-located with the resolved config (XDG branch)', () => {
  const xdgRoot = mkdtempSync(join(tmpdir(), 'scry-xdg-env-'));
  const scryDir = join(xdgRoot, 'scry');
  mkdirSync(scryDir);

  // Copy fixture config into the XDG location
  const fixtureContent = readFileSync(resolve(__dirname, '../fixtures/scry.config.yaml'), 'utf-8');
  writeFileSync(join(scryDir, 'scry.config.yaml'), fixtureContent);
  writeFileSync(join(scryDir, '.scry.env'), 'TEST_AUTH_TOKEN=from-dotenv-file');

  // Make resolution land on the XDG path: clear precedence sources
  delete process.env.SCRY_CONFIG;
  delete process.env.TEST_AUTH_TOKEN;
  process.env.XDG_CONFIG_HOME = xdgRoot;

  const tmpCwd = mkdtempSync(join(tmpdir(), 'scry-cwd-empty-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);

  try {
    const config = loadConfig();
    expect(config.llm.auth_token).toBe('from-dotenv-file');
  } finally {
    vi.restoreAllMocks();
    rmSync(xdgRoot, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  }
});
```

Update the imports at the top of `tests/config/loader.test.ts` to ensure all of these are present (Task 2 already added several — extend as needed, do not duplicate):

```typescript
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { vi } from 'vitest';
```

This test runs `loadConfig()` with no argument: it relies on the resolution chain falling through all earlier branches (no explicit, no `SCRY_CONFIG`, no CWD config) and landing on the XDG path. That exercises both the helper's XDG branch and `loadDotEnvFile(dirname(configPath) + '/.scry.env')` end-to-end.

- [ ] **Step 2: Run the new test**

```bash
npm test -- tests/config/loader.test.ts
```

Expected: all `loader.test.ts` tests pass, including the new co-location test.

- [ ] **Step 3: Commit**

```bash
git add tests/config/loader.test.ts
git commit -m "test(loader): cover .scry.env co-location via XDG path"
```

---

### Task 4: Wire helper into `cli.ts` — drop commander default, replace call sites, expand error

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update the import block**

In `src/cli.ts`, replace the loader import:

```typescript
import { loadConfig } from './config/loader.js';
```

with:

```typescript
import { loadConfig, resolveConfigPath } from './config/loader.js';
```

- [ ] **Step 2: Drop the commander default for `-c, --config`**

Find this line (currently `cli.ts:24`):

```typescript
  .option('-c, --config <path>', 'Config file path', 'scry.config.yaml')
```

Replace with:

```typescript
  .option('-c, --config <path>', 'Config file path (default: ./scry.config.yaml or ~/.config/scry/scry.config.yaml)')
```

- [ ] **Step 3: Replace inline resolution in the main query action**

Find this block (currently `cli.ts:34-40`):

```typescript
    const configPath = resolve(process.env.SCRY_CONFIG ?? opts.config);

    if (!existsSync(configPath)) {
      console.error(`Config not found: ${configPath}`);
      console.error('Run `scry init` to create a config, or set SCRY_CONFIG env var.');
      process.exit(1);
    }
```

Replace with:

```typescript
    const configPath = resolveConfigPath(opts.config);

    if (!existsSync(configPath)) {
      console.error(`Config not found at ${configPath}.`);
      console.error('Scry looks for: -c <path>, then $SCRY_CONFIG, then ./scry.config.yaml,');
      console.error('then ~/.config/scry/scry.config.yaml.');
      console.error('Run `scry init` to create one, or copy your existing config to ~/.config/scry/.');
      process.exit(1);
    }
```

- [ ] **Step 4: Add `-c` flag to `config show` and replace its inline resolution**

Find this block (currently `cli.ts:117-126`):

```typescript
program
  .command('config show')
  .description('Print current config (redacted)')
  .action(() => {
    const configPath = resolve(process.env.SCRY_CONFIG ?? 'scry.config.yaml');
    if (!existsSync(configPath)) {
      console.error('No config found. Run `scry init` to create one.');
      process.exit(1);
    }
    const config = loadConfig(configPath);
```

Replace with:

```typescript
program
  .command('config show')
  .description('Print current config (redacted)')
  .option('-c, --config <path>', 'Config file path')
  .action((opts) => {
    const configPath = resolveConfigPath(opts.config);
    if (!existsSync(configPath)) {
      console.error(`Config not found at ${configPath}.`);
      console.error('Scry looks for: -c <path>, then $SCRY_CONFIG, then ./scry.config.yaml,');
      console.error('then ~/.config/scry/scry.config.yaml.');
      console.error('Run `scry init` to create one, or copy your existing config to ~/.config/scry/.');
      process.exit(1);
    }
    const config = loadConfig(configPath);
```

- [ ] **Step 5: Remove the now-unused `resolve` import if it has no remaining callers**

Check: after the changes above, search `src/cli.ts` for remaining uses of `resolve(`. If there are none, remove `resolve` from the path import line:

```typescript
import { resolve } from 'path';
```

If `resolve` is no longer used anywhere, delete that line entirely.

(`existsSync` is still used for the not-found check — keep that import.)

- [ ] **Step 6: Build and run the full test suite**

```bash
npm run build
npm test
```

Expected: TypeScript compiles cleanly, all tests pass.

- [ ] **Step 7: Smoke-test the CLI from the repo root**

```bash
node dist/cli.js --help
```

Expected: help output shows `-c, --config <path>` description noting the default chain. No `[default: scry.config.yaml]` annotation.

```bash
node dist/cli.js config show --help
```

Expected: help output shows `-c, --config <path>` is now an option for `config show`.

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): use resolveConfigPath, drop commander default, expand not-found error

- -c, --config no longer has a hardcoded 'scry.config.yaml' default
  (which would short-circuit the XDG fallback)
- config show now accepts -c/--config for consistency
- Not-found error describes the resolution chain instead of just the
  failing path"
```

---

### Task 5: Update README configuration documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Configuration section**

In `README.md`, find the `## Configuration` section. Just under the heading, before the line `\`scry init\` generates a \`scry.config.yaml\`:`, insert a new subsection:

```markdown
### Where scry looks for config

Scry resolves the config path in this order, taking the first hit:

1. `-c <path>` flag passed on the command line
2. `SCRY_CONFIG` environment variable
3. `./scry.config.yaml` in the current working directory
4. `$XDG_CONFIG_HOME/scry/scry.config.yaml` (defaults to `~/.config/scry/scry.config.yaml`)

For a global install (`npm i -g @aviralv/scry`), the recommended setup is:

```bash
scry init -d ~/.config/scry
```

This puts the config at the XDG location so `scry "<query>"` works from any directory. A `.scry.env` file placed alongside the config (e.g. `~/.config/scry/.scry.env`) is loaded automatically and supplies secrets without exposing them in `scry.config.yaml`.

```

- [ ] **Step 2: Update the CLI Options block**

Find the CLI Options block lower in `README.md`. Replace:

```
  -c, --config <path>     Config file (default: scry.config.yaml)
```

with:

```
  -c, --config <path>     Config file (default: see resolution chain below)
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document XDG config fallback resolution chain"
```

---

### Task 6: Bump version 0.1.2 → 0.1.3

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the version field**

In `package.json`, change:

```json
  "version": "0.1.2",
```

to:

```json
  "version": "0.1.3",
```

(Do NOT touch the stale `version('0.1.0')` string in `src/cli.ts:22` — that is explicitly out of scope for this change per the spec.)

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: v0.1.3"
```

---

### Task 7: Live verification via tarball install (DEPLOYMENT.md gate)

**Files:** none (verification only)

This is the deployment-safety check required before merging. Per `the-product-kitchen/.claude/rules/DEPLOYMENT.md`: install from a branch tarball, exercise it, and only merge after Avi confirms it works.

- [ ] **Step 1: Build and pack a tarball**

```bash
npm run build
npm pack
```

Expected: produces `aviralv-scry-0.1.3.tgz` in the repo root.

- [ ] **Step 2: Install globally from the tarball**

```bash
npm i -g ./aviralv-scry-0.1.3.tgz
```

Expected: `scry` binary updated. Verify with `which scry` and `scry --help`.

- [ ] **Step 3: Set up the XDG config location**

```bash
mkdir -p ~/.config/scry
cp scry.config.yaml ~/.config/scry/
[ -f .scry.env ] && cp .scry.env ~/.config/scry/
```

- [ ] **Step 4: Run scry from a non-scry directory**

```bash
cd /tmp
scry "test query, any short search will do"
```

Expected: scry runs, hits its sources, prints synthesized results. No "Config not found" error. **This is the acceptance gate** — if this fails, do not merge.

- [ ] **Step 5: Confirm the dev workflow still works**

```bash
cd <repo-root>
node dist/cli.js "another test query"
```

Expected: still works using the CWD `scry.config.yaml`.

- [ ] **Step 6: Hand off to Avi for sign-off**

Report verification results to Avi (paths checked, queries that worked, anything anomalous). Do **not** merge to main or publish to npm without explicit approval. Per DEPLOYMENT.md: "Only merge after user confirms it works in a live session."

- [ ] **Step 7: Clean up the tarball**

```bash
rm aviralv-scry-0.1.3.tgz
```

(The tarball isn't gitignored by name; remove before opening the PR.)

---

### Task 8: Open the pull request

**Files:** none (gh only)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/xdg-config-fallback
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: XDG config-path fallback (#1)" --body "$(cat <<'EOF'
## Summary
- Adds `resolveConfigPath` helper with chain: explicit `-c` > `SCRY_CONFIG` > CWD `scry.config.yaml` > `~/.config/scry/scry.config.yaml`
- Drops the commander default for `-c, --config` (would have short-circuited the XDG fallback)
- `config show` now accepts `-c, --config` for consistency
- "Config not found" error now describes the resolution chain
- README documents the config locations
- Bumps to 0.1.3

Closes #1.

## Test plan
- [x] `npm test` — all unit tests pass, including 7 new `resolveConfigPath` cases and one `.scry.env` co-location test
- [x] `npm run build` — clean
- [x] Tarball install (`npm pack` + `npm i -g ./aviralv-scry-0.1.3.tgz`), config copied to `~/.config/scry/`, `scry "<query>"` runs from `/tmp` with no error
- [x] Existing dev workflow from `Playground/scry/` (`node dist/cli.js "<query>"`) unchanged

## Out of scope
- `scry init` defaulting `-d` to `~/.config/scry` (existing `-d` flag covers it)
- Stale `version('0.1.0')` in `src/cli.ts:22` (pre-existing, separate)
- Outlook tool name fix (separate ticket)
EOF
)"
```

- [ ] **Step 3: Wait for Avi's review and approval before merging**

Do not auto-merge. The DEPLOYMENT.md rule applies: PRs are for review, not auto-merge.

---

## Self-Review

**Spec coverage:**
- Resolution chain → Task 2
- `.scry.env` co-location works for XDG → Task 3
- Drop commander default → Task 4 step 2
- Replace 2 cli.ts call sites → Task 4 steps 3-4
- Add `-c` to `config show` → Task 4 step 4
- Expand error message → Task 4 steps 3 and 4
- Empty `XDG_CONFIG_HOME` handling → covered in Task 2 helper code + test case
- Use `resolve()` not `join()` for XDG path → Task 2 helper code
- Tests #1-#7 from spec → Task 2 has 6 cases (#1-#6) + Task 3 has #7
- README "Configuration" section → Task 5
- Version bump → Task 6
- Branch-based deployment → Task 1, Task 7
- All acceptance criteria addressed.

**Placeholder scan:** None. Each step has the exact file paths, code, and commands.

**Type consistency:** `resolveConfigPath(explicit?: string): string` is consistent across helper, callers, and tests. `loadConfig(path?: string)` signature unchanged.

Plan is ready for execution.
