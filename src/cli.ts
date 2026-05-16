#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig } from './config/loader.js';
import { getRegistry } from './core/registry.js';
import { detectEntities } from './core/detector.js';
import { buildSearchPlan } from './core/planner.js';
import { McpPool } from './core/mcp-pool.js';
import { normalizeSlackResults, normalizeConfluenceResults, normalizeEmailResults } from './core/normalizer.js';
import { synthesize } from './core/synthesizer.js';
import type { SearchResult } from './config/types.js';

const program = new Command();

program
  .name('scry')
  .description('Federated search orchestrator over MCP')
  .version('0.1.0')
  .argument('[query...]', 'Search query')
  .option('-c, --config <path>', 'Config file path', 'scry.config.yaml')
  .option('--no-synthesize', 'Skip LLM synthesis, show raw results')
  .action(async (queryParts: string[], opts) => {
    const query = queryParts.join(' ');
    if (!query) {
      program.help();
      return;
    }

    const configPath = resolve(opts.config);

    if (!existsSync(configPath)) {
      console.error(`Config not found: ${configPath}`);
      console.error('Copy scry.config.example.yaml → scry.config.yaml and fill in values.');
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

      const searchPromises = plan.map(async (action) => {
        try {
          const raw = await pool.callTool(action.tool, action.params);
          return { server: action.server, tool: action.tool, raw };
        } catch (err) {
          console.error(`⟐ ${action.server}/${action.tool} failed: ${err}`);
          return { server: action.server, tool: action.tool, raw: '' };
        }
      });

      const rawResults = await Promise.all(searchPromises);

      const allResults: SearchResult[] = [];
      for (const { server, tool, raw } of rawResults) {
        if (!raw) continue;
        if (tool === 'slack_search') {
          allResults.push(...normalizeSlackResults(raw));
        } else if (tool === 'confluence_search') {
          allResults.push(...normalizeConfluenceResults(raw));
        } else if (tool === 'outlook_list_messages') {
          allResults.push(...normalizeEmailResults(raw));
        }
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
    const configPath = resolve('scry.config.yaml');
    if (!existsSync(configPath)) {
      console.error('No config found.');
      process.exit(1);
    }
    const config = loadConfig(configPath);
    console.log('LLM:', config.llm.model, '@', config.llm.base_url);
    console.log('Servers:', Object.keys(config.mcp_servers).join(', '));
    console.log('Search tools:', Object.entries(config.search_tools).map(
      ([s, tools]) => `${s}: ${tools.map(t => t.tool).join(', ')}`
    ).join(' | '));
  });

program.parse();
