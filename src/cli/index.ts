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
  .version('0.2.0');

registerHeadless(program);
registerServe(program);
registerConfigShow(program);
registerInit(program);

program.parse();
