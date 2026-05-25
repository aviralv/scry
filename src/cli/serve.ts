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
