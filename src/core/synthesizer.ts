import type { SearchResult, LlmConfig, SynthesisResult, Citation } from '../config/types.js';

const SYSTEM_PROMPT = `You are a search synthesis engine. Given a user's question and search results from multiple sources, provide a concise answer with inline citations.

Rules:
- Cite sources as [1], [2], etc.
- If results are insufficient to answer, say so explicitly
- Prioritize recent results over old ones
- Note disagreements between sources
- Keep answer under 200 words unless the question demands more`;

export function buildSynthesisPrompt(query: string, results: SearchResult[]): string {
  const resultBlock = results
    .map((r, i) => {
      const header = `[${i + 1}] ${r.source} — ${r.title} — ${r.author ?? 'unknown'} — ${r.timestamp}`;
      return `${header}\n    ${r.snippet}`;
    })
    .join('\n\n');

  return `Question: ${query}\n\nResults:\n${resultBlock}`;
}

export function parseSynthesisResponse(text: string, results: SearchResult[]): Citation[] {
  const indices = new Set<number>();
  const regex = /\[(\d+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    indices.add(Number(match[1]));
  }

  const citations: Citation[] = [];
  for (const idx of indices) {
    const result = results[idx - 1];
    if (result) {
      citations.push({
        index: idx,
        source: result.source,
        title: result.title,
        url: result.url,
        author: result.author,
        timestamp: result.timestamp,
      });
    }
  }

  return citations.sort((a, b) => a.index - b.index);
}

export async function synthesize(
  query: string,
  results: SearchResult[],
  llmConfig: LlmConfig
): Promise<SynthesisResult> {
  const userMessage = buildSynthesisPrompt(query, results);

  const url = `${llmConfig.base_url.replace(/\/$/, '')}/v1/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': llmConfig.auth_token,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: llmConfig.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API error ${response.status}: ${body}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  const answerText = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('');

  const citations = parseSynthesisResponse(answerText, results);
  return { answer: answerText, citations };
}
