# scry v2 — Plan B Part 2: CLI rewire + delete old engine + PR

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Continuation of [`2026-05-24-scry-engine-pivot.md`](./2026-05-24-scry-engine-pivot.md).

**State at start of part 2:** T1–T5 done. New `src/engine/` module exists with passing tests. Old `src/core/*` engine still wired into `src/cli.ts`. Goal of part 2: switch the CLI's query path to `runQuery`, then delete old engine.

---

### Task 6: Restructure CLI into a directory

**Goal:** Split the current `src/cli.ts` into modules per subcommand, keeping behavior identical. The query path still uses the old engine — switching to `runQuery` happens in Task 7.

**Files:**
- Create: `src/cli/index.ts`, `src/cli/headless.ts`, `src/cli/serve.ts`, `src/cli/config-show.ts`, `src/cli/init.ts`
- Modify: `src/cli.ts` (becomes a 2-line entry)

- [ ] **Step 1: Read the current `src/cli.ts`** to identify the four blocks (default action / `config show` / `init` / `serve`) and the `resolveNormalizer` helper.

- [ ] **Step 2: Create `src/cli/headless.ts`** containing the current default-action body (the `scry "<query>"` action that uses `McpPool`, `buildSearchPlan`, `synthesize`). Export as `registerHeadless(program: Command)`. Move `resolveNormalizer` here too — it's only used by the headless path.

```typescript
// src/cli/headless.ts
import type { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig, resolveConfigPath } from '../config/loader.js';
import { getRegistry } from '../core/registry.js';
import { detectEntities } from '../core/detector.js';
import { buildSearchPlan } from '../core/planner.js';
import { McpPool } from '../core/mcp-pool.js';
import { normalizerRegistry, normalizeGeneric } from '../core/normalizer.js';
import type { NormalizerFn } from '../core/normalizer.js';
import { findBundledServer } from '../config/bundled-servers.js';
import { synthesize } from '../core/synthesizer.js';
import type { ScryConfig, SearchResult } from '../config/types.js';

// NOTE: This file uses the OLD engine via src/core/*. Task 7 replaces this
// body with a call to runQuery. Task 8 deletes src/core/*.

export function registerHeadless(program: Command): void {
  program
    .argument('[query...]', 'Search query')
    .option('-c, --config <path>', 'Config file path (default: ./scry.config.yaml or ~/.config/scry/scry.config.yaml)')
    .option('--no-synthesize', 'Skip LLM synthesis, show raw results')
    .option('-t, --timeout <ms>', 'Per-source timeout in ms', '15000')
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(' ');
      if (!query) {
        program.help();
        return;
      }

      const configPath = resolveConfigPath(opts.config);
      if (!existsSync(configPath)) {
        console.error(`Config not found at ${configPath}.`);
        console.error('Scry looks for: -c <path>, then $SCRY_CONFIG, then ./scry.config.yaml,');
        console.error('then ~/.config/scry/scry.config.yaml.');
        console.error('Run `scry init` to create one, or copy your existing config to ~/.config/scry/.');
        process.exit(1);
      }

      const config = loadConfig(configPath);
      const registry = getRegistry(config);

      const entities = detectEntities(query, registry);
      if (entities.projects.length > 0 || entities.people.length > 0) {
        const names = [
          ...entities.projects.map((p) => p.name),
          ...entities.people.map((p) => p.name),
        ];
        console.error(`⟐ Detected: ${names.join(', ')}`);
      }

      const plan = buildSearchPlan(query, entities, config);
      console.error(`⟐ Searching ${plan.length} sources...`);

      const pool = new McpPool();
      try {
        await pool.connect(config.mcp_servers);
        const timeoutMs = parseInt(opts.timeout ?? '15000', 10);
        const searchPromises = plan.map(async (action) => {
          const raw = await pool.callTool(action.tool, action.params, timeoutMs);
          return { server: action.server, tool: action.tool, raw };
        });
        const settled = await Promise.allSettled(searchPromises);
        const allResults: SearchResult[] = [];
        const failures: string[] = [];
        for (const result of settled) {
          if (result.status === 'fulfilled' && result.value.raw) {
            const { server, tool, raw } = result.value;
            const normalize = resolveNormalizer(server, tool, config);
            allResults.push(...normalize(raw, server));
          } else if (result.status === 'rejected') {
            failures.push(result.reason?.message ?? 'unknown error');
          }
        }
        if (failures.length > 0) {
          console.error(`⟐ ${failures.length} source(s) failed: ${failures.join('; ')}`);
        }
        if (allResults.length === 0) {
          console.log('No results found across any source.');
          return;
        }
        console.error(`⟐ Found ${allResults.length} results, synthesizing...`);
        if (!opts.synthesize) {
          for (const r of allResults) {
            console.log(`[${r.source}] ${r.title} — ${r.author ?? ''}`);
            console.log(`  ${r.snippet.slice(0, 120)}`);
            console.log(`  ${r.url ?? ''}\n`);
          }
          return;
        }
        const result = await synthesize(query, allResults, config.llm);
        console.log('');
        console.log(result.answer);
        console.log('');
        console.log('Sources:');
        for (const c of result.citations) {
          console.log(`[${c.index}] ${c.source}: ${c.title} — ${c.author ?? 'unknown'} — ${c.timestamp}`);
          if (c.url) console.log(`    ${c.url}`);
        }
      } finally {
        await pool.shutdown();
      }
    });
}

function resolveNormalizer(server: string, tool: string, config: ScryConfig): NormalizerFn {
  const toolConfigs = config.search_tools[server] ?? [];
  const toolConfig = toolConfigs.find((t) => t.tool === tool);
  if (toolConfig?.normalizer) {
    return normalizerRegistry.get(toolConfig.normalizer) ?? normalizeGeneric;
  }
  const serverConfig = config.mcp_servers[server];
  if (serverConfig) {
    const bundled = findBundledServer(serverConfig.command);
    const bundledTool = bundled?.searchTools.find((t) => t.tool === tool);
    if (bundledTool?.normalizer) {
      return normalizerRegistry.get(bundledTool.normalizer) ?? normalizeGeneric;
    }
  }
  return normalizeGeneric;
}
```

- [ ] **Step 3: Create `src/cli/serve.ts`** containing the current `serve` subcommand body.

```typescript
// src/cli/serve.ts
import type { Command } from 'commander';
import open from 'open';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the scry web GUI on localhost')
    .option('-p, --port <number>', 'Port to listen on', '6678')
    .option('--no-open', 'Skip opening the browser')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${opts.port}`);
        process.exit(1);
      }
      const { startServer } = await import('../server/boot.js');
      try {
        await startServer({ port });
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EADDRINUSE') {
          console.error(`Port ${port} is already in use. Pick another with -p, or stop the process using it.`);
        } else {
          console.error(`Failed to start server: ${e.message ?? e}`);
        }
        process.exit(1);
      }
      const url = `http://127.0.0.1:${port}`;
      console.error(`⟐ scry web running at ${url}`);
      if (opts.open !== false) {
        await open(url);
      }
    });
}
```

- [ ] **Step 4: Create `src/cli/config-show.ts`** containing the current `config show` body.

```typescript
// src/cli/config-show.ts
import type { Command } from 'commander';
import { existsSync } from 'fs';
import { loadConfig, resolveConfigPath } from '../config/loader.js';

export function registerConfigShow(program: Command): void {
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
      console.log('LLM:', config.llm.model, '@', config.llm.base_url);
      console.log('Servers:', Object.keys(config.mcp_servers).join(', '));
      console.log(
        'Search tools:',
        Object.entries(config.search_tools)
          .map(([s, tools]) => `${s}: ${tools.map((t) => t.tool).join(', ')}`)
          .join(' | '),
      );
      if (config.registry) {
        const people = Object.keys(config.registry.people ?? {});
        const projects = Object.keys(config.registry.projects ?? {});
        if (people.length > 0) console.log('People:', people.join(', '));
        if (projects.length > 0) console.log('Projects:', projects.join(', '));
      }
    });
}
```

- [ ] **Step 5: Create `src/cli/init.ts`** (re-exports the existing wizard).

```typescript
// src/cli/init.ts
import type { Command } from 'commander';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Set up scry configuration interactively')
    .option('-d, --dir <path>', 'Output directory', '.')
    .action(async (opts) => {
      const { runInit } = await import('../init/init.js');
      await runInit(opts.dir);
    });
}
```

- [ ] **Step 6: Create `src/cli/index.ts`** as the orchestrator.

```typescript
// src/cli/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { registerHeadless } from './headless.js';
import { registerServe } from './serve.js';
import { registerConfigShow } from './config-show.js';
import { registerInit } from './init.js';

const program = new Command();

program
  .name('scry')
  .description('Federated search orchestrator over MCP')
  .version('0.1.3');

registerHeadless(program);
registerServe(program);
registerConfigShow(program);
registerInit(program);

program.parse();
```

Note: the shebang `#!/usr/bin/env node` lives here. The `bin` field in `package.json` should point at `dist/cli/index.js` after this restructure (Task 8 updates it).

- [ ] **Step 7: Replace `src/cli.ts` with a 2-line entry**

```typescript
#!/usr/bin/env node
import './cli/index.js';
```

This keeps backward compatibility for anyone with a stale `bin` mapping until Task 8 updates `package.json`.

- [ ] **Step 8: Build + smoke-test**

```bash
npm run build 2>&1 | tail -3
npm test 2>&1 | tail -3
node dist/cli.js --help
node dist/cli.js config show 2>&1 | head -3 || true
```

Expected: build clean, all tests pass, `--help` lists `serve`, `config`, `init`, and the default query argument.

- [ ] **Step 9: Commit**

```bash
git add src/cli/ src/cli.ts
git commit -m "refactor(cli): split cli.ts into per-subcommand modules"
```

---

### Task 7: Rewire `headless.ts` to use `runQuery`

**Files:** Modify `src/cli/headless.ts`. Modify `package.json` (`bin` and `version` and `main`).

- [ ] **Step 1: Replace the headless action body with a `runQuery` call**

Full new contents of `src/cli/headless.ts`:

```typescript
// src/cli/headless.ts
import type { Command } from 'commander';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig, resolveConfigPath } from '../config/loader.js';
import { runQuery } from '../engine/runQuery.js';
import type { RunQueryEvent } from '../engine/types.js';

export function registerHeadless(program: Command): void {
  program
    .argument('[query...]', 'Search query')
    .option('-c, --config <path>', 'Config file path (default: ./scry.config.yaml or ~/.config/scry/scry.config.yaml)')
    .option('--fanout', 'Force the agent to call all configured search tools first')
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(' ');
      if (!query) {
        program.help();
        return;
      }

      const configPath = resolveConfigPath(opts.config);
      if (!existsSync(configPath)) {
        console.error(`Config not found at ${configPath}.`);
        console.error('Scry looks for: -c <path>, then $SCRY_CONFIG, then ./scry.config.yaml,');
        console.error('then ~/.config/scry/scry.config.yaml.');
        console.error('Run `scry init` to create one, or copy your existing config to ~/.config/scry/.');
        process.exit(1);
      }

      const config = loadConfig(configPath);
      const scryConfigDir = dirname(resolve(configPath));

      const stream = runQuery({
        prompt: query,
        config,
        scryConfigDir,
        fanoutMode: Boolean(opts.fanout),
      });

      // Print events as they arrive. Cancel on Ctrl-C.
      const ctl = new AbortController();
      process.on('SIGINT', () => ctl.abort());

      for await (const event of stream) {
        printEvent(event);
        if (ctl.signal.aborted) break;
      }
    });
}

function printEvent(event: RunQueryEvent): void {
  switch (event.type) {
    case 'session-init':
      console.error(`⟐ session ${event.sessionId.slice(0, 8)}`);
      break;
    case 'tool-call':
      console.error(`⟐ → ${event.tool}`);
      break;
    case 'tool-result':
      console.error(`⟐   [${event.sourceIndex}] ${event.source.title}`);
      break;
    case 'assistant-text':
      process.stdout.write(event.text + '\n');
      break;
    case 'citation':
      // Inline citations are visible in the assistant text already; no extra log.
      break;
    case 'done':
      if (event.sources.length > 0) {
        console.log('');
        console.log('Sources:');
        for (const s of event.sources) {
          console.log(`[${s.index}] ${s.source}: ${s.title} — ${s.author ?? 'unknown'} — ${s.timestamp ?? ''}`);
          if (s.url) console.log(`    ${s.url}`);
        }
      }
      break;
    case 'error':
      console.error(`⟐ error: ${event.message}`);
      process.exitCode = 1;
      break;
  }
}
```

The new headless flow: prints `tool-call` and `tool-result` events as status pips to stderr, streams `assistant-text` to stdout, prints the source list at the end. Same shape as before, simpler implementation, no per-source query templating (Claude does that).

- [ ] **Step 2: Update `package.json`** — bump `bin` target if needed and bump version.

```json
{
  "main": "./dist/cli/index.js",
  "version": "0.2.0",
  "bin": {
    "scry": "dist/cli/index.js"
  },
  ...
}
```

(Version bump: 0.1.3 → 0.2.0 because the engine is materially different. Minor bump per semver since the CLI surface is unchanged at the command level — only output formatting differs slightly.)

`src/cli.ts` (the legacy 2-line wrapper) can stay or be deleted; if deleted, also remove any stale references. Simpler to just delete.

- [ ] **Step 3: Build + run a tiny smoke test (no real LLM)**

```bash
rm -rf dist && npm run build 2>&1 | tail -3
```

To smoke-test the full flow without burning real API quota, you can either:
- Run `node dist/cli/index.js --help` (no LLM call) and confirm it shows the new `--fanout` flag and the `[query...]` arg.
- Or run a real query against your local Hyperspace proxy if you have it running. **Don't auto-do that in this plan** — it costs tokens.

```bash
node dist/cli/index.js --help
```

Expected: help text shows `serve`, `config`, `init`, `[query...]`, `-c, --config`, `--fanout`.

- [ ] **Step 4: Commit**

```bash
git add src/cli/headless.ts package.json
git rm src/cli.ts # if you chose to delete it
git commit -m "feat(cli): scry \"<query>\" now flows through runQuery (engine pivot)

CLI's headless query path replaced its custom planner+pool+normalizer+
synthesizer pipeline with a single runQuery call to @anthropic-ai/
claude-agent-sdk. Same registry, same MCPs, same .scry.env. Output
shape: status pips on stderr (tool-call, tool-result), assistant text
on stdout, source list at the end.

Adds --fanout flag for forcing the agent to call all configured tools
in its first turn. Default behavior is smart routing (Claude decides
which tools are relevant per query).

Bumps to 0.2.0."
```

---

### Task 8: Delete the old engine

**Files:** Delete `src/core/{planner,mcp-pool,normalizer,synthesizer,registry,detector}.ts` and their tests. Delete any `src/core/abort.ts` if it lingered. Delete `src/core/index.ts` or other internal re-exports.

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rln "from.*core/" src/ tests/ web/ 2>/dev/null
```

Expected: empty output. If any file still imports from `src/core/`, fix it before proceeding.

- [ ] **Step 2: Delete the files**

```bash
git rm -r src/core/ tests/core/
```

If `tests/core/` doesn't exist, the second `tests/core/` arg is harmless if quoted as a noop, but if `git rm` errors, drop it. Other tests that might reference deleted names:

```bash
grep -rln "registry\.ts\|detector\.ts\|planner\.ts\|mcp-pool\.ts\|normalizer\.ts\|synthesizer\.ts" tests/ 2>/dev/null
```

Update any stragglers. The new engine's tests live under `tests/engine/`.

- [ ] **Step 3: Build + test**

```bash
npm run build 2>&1 | tail -3
npm test 2>&1 | tail -5
```

Expected: build clean, all remaining tests pass. Test count drops by however many tests were in `tests/core/`. The new tests added in T2–T5 plus the existing server / config / web tests should remain green.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete old src/core/ engine; superseded by src/engine/"
```

---

### Task 9: Push + open PR

- [ ] **Step 1: Verify gh account is `aviralv` (personal repo)**

```bash
gh auth status 2>&1 | grep -E "(account|Active)" | head -4
```

If `aviralvaid` is active, switch:

```bash
gh auth switch --hostname github.com --user aviralv
```

- [ ] **Step 2: Push**

```bash
git push -u origin feat/engine-pivot
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat: engine pivot to Claude Agent SDK (Plan B)" --body "$(cat <<'EOF'
## Summary

Plan B of the v2 rollout. Replaces scry's custom engine (planner, mcp-pool,
normalizer, synthesizer) with @anthropic-ai/claude-agent-sdk. Same registry,
same MCPs, same .scry.env — smarter routing (Claude decides which tools to
call per query) and follow-up turn capability via session_id resume.

This PR lands:
- New \`src/engine/\` module: \`runQuery\` wraps the SDK's \`query()\` async
  iterable; emits typed RunQueryEvents (\`session-init\`, \`tool-call\`,
  \`tool-result\`, \`assistant-text\`, \`citation\`, \`done\`, \`error\`).
- \`src/engine/system-prompt.ts\` — pure composer (registry + synthesis rules
  + optional fanout directive).
- \`src/engine/source-tracker.ts\` — session-scoped \`[N]\` assignment with
  marker validation; numbering stable across follow-up turns.
- CLI restructure into \`src/cli/\` directory; one module per subcommand.
- \`scry "<query>"\` now flows through \`runQuery\`. Output shape: status
  pips on stderr (tool calls, tool results), assistant text on stdout,
  source list at the end.
- New \`--fanout\` flag for forcing the agent to call all configured tools
  in its first turn.
- Old \`src/core/*\` deleted.
- Bumps to 0.2.0.

Spec: [\`docs/superpowers/specs/2026-05-22-scry-web-frontend-v2-design.md\`](./docs/superpowers/specs/2026-05-22-scry-web-frontend-v2-design.md)
Plan: [\`docs/superpowers/plans/2026-05-24-scry-engine-pivot.md\`](./docs/superpowers/plans/2026-05-24-scry-engine-pivot.md) + [part 2](./docs/superpowers/plans/2026-05-24-scry-engine-pivot-part2.md)

## Test plan

- [x] \`npm test\` — all unit tests pass: new \`tests/engine/\` (system-prompt, source-tracker, runQuery with injected fake) + existing server/config/web tests untouched
- [x] \`npm run build\` — server tsc clean + web Vite build clean
- [x] \`scry --help\` lists serve, config, init, [query...], --fanout
- [x] \`scry "test query"\` runs through runQuery (verify with a live query against your Hyperspace proxy)
- [x] \`npm pack --dry-run\` ships only \`dist/\` and \`README.md\`

## Out of scope (later plans)

- Storage layer (SQLite for sessions index) — Plan C, when first needed
- Search route + UI — Plan C
- Library sidebar with persistent history — Plan D
- MCP/Registry/Onboarding/Preferences UIs — Plans E–H
- E2E hardening + npm publish — Plan I

Per \`DEPLOYMENT.md\`: PRs are for review, not auto-merge. Don't merge until
you've verified \`scry "<query>"\` works against your real config.
EOF
)"
```

---

## Self-review

**Spec coverage:**
- v2 spec § Engine module → T2–T5 (types, system-prompt, source-tracker, runQuery)
- v2 spec § runQuery internal flow (loadDotEnvFile, systemPrompt, mcpServers, cwd, AbortController, session-resume) → T5
- v2 spec § Citation determinism (session-scoped, drop unmapped) → T4 + T5
- v2 spec § AbortSignal → T5
- v2 spec § "scry passes cwd: <scryConfigDir> explicitly to every query() call" → T5 + T7 (cli passes `dirname(resolve(configPath))`)
- v2 spec § CLI kept as headless flavor of same engine → T6 + T7
- v2 spec § "Single engine, two transports" → T6 establishes the seam (server route in Plan C uses the same `runQuery`)
- v2 spec § Removed deps `@anthropic-ai/sdk` → T1
- v2 spec § Removed src/core/* → T8

Out of scope (deferred): storage, search route + UI, library sidebar, MCP/registry/onboarding/preferences UIs.

**Placeholder scan:** None. Each step has its actual code or actual command.

**Type consistency:**
- `RunQueryOptions` defined in T2 used in T5 + T7.
- `RunQueryEvent` discriminated union consistent across types, runQuery, headless.
- `SourceCard` defined in T2 used in T4, T5, T7.
- `SourceTracker` constructor takes `prior: SourceCard[]` — same shape across T4 + T5.
- The dispatch keys in T5 (`m.type === 'system'`, `m.type === 'assistant'`, etc.) are an educated guess. Step 1 of T5 explicitly directs the implementer to read the SDK's d.ts and adapt the names if needed. Test fixtures in T5 mirror the same shape; both must be adjusted together if the real SDK differs.

Plan ready for execution.
