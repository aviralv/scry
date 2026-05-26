import type { Registry } from '../config/types.js';

interface BuildSystemPromptOptions {
  registry: Registry;
  fanoutMode: boolean;
  serverNames: string[];
}

const IDENTITY = `You are scry, a federated search assistant.
You answer the user's question by calling the configured search tools (Slack, Confluence, Jira, email, etc.) and synthesizing the results.`;

function buildOutputRules(serverNames: string[]): string {
  const validLabels = serverNames.length > 0
    ? serverNames.map((n) => `\`${n}\``).join(', ')
    : '(none configured)';
  return `Output rules:
- Cite sources inline as [1], [2], etc. — one citation per claim.
- If a tool returns no relevant results, say so explicitly rather than inventing content.
- If two sources disagree, surface the disagreement.
- Prioritize recent results when timestamps are available.
- Keep the answer under 200 words unless the question demands more.
- After your answer, emit a "Sources:" heading on its own line, then list each
  cited source on its own line formatted: \`[N] <source-name>: <title> — <url-if-known>\`.
  Use the same [N] indices you used inline. Use markdown link syntax for URLs.
- The <source-name> MUST be one of: ${validLabels}. Do NOT invent labels like
  "Vault", "Notes", "Memory", "Files", or any name not in this list. If a tool
  result mentions a path or filename, that does not make it a separate source —
  cite it under the tool that returned it.`;
}

const FANOUT_DIRECTIVE = `Search-mode override: the user has activated fanout mode. Call ALL configured search tools in your first turn before producing any prose, then synthesize across the combined results.`;

export function buildSystemPrompt(opts: BuildSystemPromptOptions): string {
  const sections: string[] = [IDENTITY];

  const hasRegistry =
    Object.keys(opts.registry.people ?? {}).length > 0 ||
    Object.keys(opts.registry.projects ?? {}).length > 0;
  if (hasRegistry) {
    sections.push(`Context (registry):\n${JSON.stringify(opts.registry, null, 2)}`);
  }

  sections.push(buildOutputRules(opts.serverNames));

  if (opts.fanoutMode) {
    sections.push(FANOUT_DIRECTIVE);
  }

  return sections.join('\n\n');
}
