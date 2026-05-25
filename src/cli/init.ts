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
