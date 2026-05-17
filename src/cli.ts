#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig } from './config/loader.js';
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
  .version('0.1.0')
  .argument('[query...]', 'Search query')
  .option('-c, --config <path>', 'Config file path', 'scry.config.yaml')
  .option('--no-synthesize', 'Skip LLM synthesis, show raw results')
  .option('-t, --timeout <ms>', 'Per-source timeout in ms', '15000')
  .action(async (queryParts: string[], opts) => {
    const query = queryParts.join(' ');
    if (!query) {
      program.help();
      return;
    }

    const configPath = resolve(process.env.SCRY_CONFIG ?? opts.config);

    if (!existsSync(configPath)) {
      console.error(`Config not found: ${configPath}`);
      console.error('Run `scry init` to create a config, or set SCRY_CONFIG env var.');
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
  .action(() => {
    const configPath = resolve(process.env.SCRY_CONFIG ?? 'scry.config.yaml');
    if (!existsSync(configPath)) {
      console.error('No config found. Run `scry init` to create one.');
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
