import type { Registry } from '../config/types.js';

interface BuildSystemPromptOptions {
  registry: Registry;
  fanoutMode: boolean;
}

const IDENTITY = `You are scry, a federated search assistant.
You answer the user's question by calling the configured search tools (Slack, Confluence, Jira, email, etc.) and synthesizing the results.`;

const OUTPUT_RULES = `Output rules:
- Cite sources inline as [1], [2], etc. — one citation per claim.
- If a tool returns no relevant results, say so explicitly rather than inventing content.
- If two sources disagree, surface the disagreement.
- Prioritize recent results when timestamps are available.
- Keep the answer under 200 words unless the question demands more.`;

const FANOUT_DIRECTIVE = `Search-mode override: the user has activated fanout mode. Call ALL configured search tools in your first turn before producing any prose, then synthesize across the combined results.`;

export function buildSystemPrompt(opts: BuildSystemPromptOptions): string {
  const sections: string[] = [IDENTITY];

  const hasRegistry =
    Object.keys(opts.registry.people ?? {}).length > 0 ||
    Object.keys(opts.registry.projects ?? {}).length > 0;
  if (hasRegistry) {
    sections.push(`Context (registry):\n${JSON.stringify(opts.registry, null, 2)}`);
  }

  sections.push(OUTPUT_RULES);

  if (opts.fanoutMode) {
    sections.push(FANOUT_DIRECTIVE);
  }

  return sections.join('\n\n');
}
