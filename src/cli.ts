#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import open from 'open';
import { loadConfig, resolveConfigPath } from './config/loader.js';
import { getRegistry } from './core/registry.js';
import { detectEntities } from './core/detector.js';
import { buildSearchPlan } from './core/planner.js';
import { McpPool } from './core/mcp-pool.js';
import { normalizerRegistry, normalizeGeneric } from './core/normalizer.js';
import type { NormalizerFn } from './core/normalizer.js';
import { findBundledServer } from './config/bundled-servers.js';
import { synthesize } from './core/synthesizer.js';
import type { ScryConfig, SearchResult } from './config/types.js';

const program = new Command();

program
  .name('scry')
  .description('Federated search orchestrator over MCP')
  .version('0.1.3')
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
        ...entities.projects.map(p => p.name),
        ...entities.people.map(p => p.name),
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
    console.log('Search tools:', Object.entries(config.search_tools).map(
      ([s, tools]) => `${s}: ${tools.map(t => t.tool).join(', ')}`
    ).join(' | '));
    if (config.registry) {
      const people = Object.keys(config.registry.people ?? {});
      const projects = Object.keys(config.registry.projects ?? {});
      if (people.length > 0) console.log('People:', people.join(', '));
      if (projects.length > 0) console.log('Projects:', projects.join(', '));
    }
  });

program
  .command('init')
  .description('Set up scry configuration interactively')
  .option('-d, --dir <path>', 'Output directory', '.')
  .action(async (opts) => {
    const { runInit } = await import('./init/init.js');
    await runInit(opts.dir);
  });

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
    const { startServer } = await import('./server/boot.js');
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

function resolveNormalizer(server: string, tool: string, config: ScryConfig): NormalizerFn {
  const toolConfigs = config.search_tools[server] ?? [];
  const toolConfig = toolConfigs.find(t => t.tool === tool);
  if (toolConfig?.normalizer) {
    return normalizerRegistry.get(toolConfig.normalizer) ?? normalizeGeneric;
  }
  const serverConfig = config.mcp_servers[server];
  if (serverConfig) {
    const bundled = findBundledServer(serverConfig.command);
    const bundledTool = bundled?.searchTools.find(t => t.tool === tool);
    if (bundledTool?.normalizer) {
      return normalizerRegistry.get(bundledTool.normalizer) ?? normalizeGeneric;
    }
  }
  return normalizeGeneric;
}

program.parse();
