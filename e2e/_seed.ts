// e2e/_seed.ts
//
// Shared helper: restore the "wizard completed" config state. Imported by
// each spec's beforeAll so specs 02–05 don't depend on spec 01 having
// completed cleanly. If spec 01 aborts before its own afterAll fires, this
// undoes the damage.

import { writeFileSync } from 'fs';
import { join } from 'path';

const SEED_CONFIG = `llm: {}
mcp_servers: {}
search_tools: {}
onboarding:
  completed: true
  llm_skipped: true
  mcps_skipped: true
`;

export function seedCompletedConfig(): void {
  const xdgHome = process.env.SCRY_E2E_XDG_HOME;
  if (!xdgHome) {
    throw new Error('SCRY_E2E_XDG_HOME not set — globalSetup did not run?');
  }
  writeFileSync(join(xdgHome, 'scry', 'scry.config.yaml'), SEED_CONFIG, 'utf-8');
}
