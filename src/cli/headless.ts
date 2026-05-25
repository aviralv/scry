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

      const ctl = new AbortController();
      const onSigint = () => ctl.abort();
      process.once('SIGINT', onSigint);

      try {
        const stream = runQuery({
          prompt: query,
          config,
          scryConfigDir,
          signal: ctl.signal,
          fanoutMode: Boolean(opts.fanout),
        });

        for await (const event of stream) {
          printEvent(event);
          if (ctl.signal.aborted) break;
        }
      } finally {
        process.removeListener('SIGINT', onSigint);
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
      // The source-tracker accumulates raw tool_result data for the future
      // GUI source rail (Plan C). In the CLI we don't print a sources block:
      // Claude's synthesis already enumerates sources at the end of its
      // answer with proper titles + URLs, and Claude's [N] citations index
      // its own enumeration (not scry's arrival-order list). Printing a
      // separate scry list would be both redundant and misleading.
      break;
    case 'assistant-text':
      process.stdout.write(event.text + '\n');
      break;
    case 'citation':
      break;
    case 'sources-finalized':
      // GUI-only event; CLI relies on Claude's prose Sources block in 'assistant-text'.
      break;
    case 'done':
      // No `Sources:` block — Claude's synthesis already enumerates sources.
      break;
    case 'error':
      console.error(`⟐ error: ${event.message}`);
      process.exitCode = 1;
      break;
  }
}
