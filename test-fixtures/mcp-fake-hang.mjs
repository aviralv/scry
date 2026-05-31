#!/usr/bin/env node
// Reads init then never responds. Used to exercise timeout + PGID kill.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', () => { /* swallow */ });
// Keep alive forever
setInterval(() => {}, 1 << 30);
