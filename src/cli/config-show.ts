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
