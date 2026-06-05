import { apiJson } from './api.js';

/**
 * Subset of the server-side BundledServer type — omits searchTools (internal
 * orchestration data the wizard doesn't need). Keeps the client/server
 * contract narrower than the server's BUNDLED_SERVERS catalogue.
 */
export interface BundledServerView {
  name: string;
  slug: string;
  command: string;
  githubUrl: string;
  description: string;
  envVars?: string[];
}

export interface DiscoverResult {
  bundled: BundledServerView[];
  pathInstalled: string[];
}

export async function discoverMcps(): Promise<DiscoverResult> {
  return apiJson<DiscoverResult>('/api/mcps/discover');
}
