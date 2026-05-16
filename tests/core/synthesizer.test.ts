import { describe, it, expect, vi } from 'vitest';
import { buildSynthesisPrompt, parseSynthesisResponse, synthesize } from '../../src/core/synthesizer.js';
import type { SearchResult, LlmConfig } from '../../src/config/types.js';

const sampleResults: SearchResult[] = [
  {
    source: 'slack',
    title: '#team-nova-internal',
    snippet: 'We decided on per-document pricing for ECA',
    author: 'marcus.karlbowski',
    timestamp: '2026-05-05T10:00:00.000Z',
    url: 'https://leanix.slack.com/archives/C123/p123',
    metadata: {},
  },
  {
    source: 'confluence',
    title: 'ECA Pricing Strategy',
    snippet: 'Tiered pricing model based on document volume',
    author: null,
    timestamp: '2026-05-04T08:00:00.000Z',
    url: 'https://leanix.atlassian.net/wiki/spaces/NOVA/pages/456',
    metadata: { space: 'NOVA' },
  },
];

describe('buildSynthesisPrompt', () => {
  it('includes the original query', () => {
    const prompt = buildSynthesisPrompt('ECA pricing', sampleResults);
    expect(prompt).toContain('ECA pricing');
  });

  it('numbers results sequentially', () => {
    const prompt = buildSynthesisPrompt('ECA pricing', sampleResults);
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('[2]');
  });

  it('includes source, title, author, and snippet', () => {
    const prompt = buildSynthesisPrompt('ECA pricing', sampleResults);
    expect(prompt).toContain('slack');
    expect(prompt).toContain('#team-nova-internal');
    expect(prompt).toContain('marcus.karlbowski');
    expect(prompt).toContain('per-document pricing');
  });
});

describe('parseSynthesisResponse', () => {
  it('extracts citation indices from bracketed numbers', () => {
    const text = 'The team decided on tiered pricing [1]. The doc confirms this [2].';
    const citations = parseSynthesisResponse(text, sampleResults);
    expect(citations).toHaveLength(2);
    expect(citations[0].index).toBe(1);
    expect(citations[0].source).toBe('slack');
    expect(citations[1].index).toBe(2);
    expect(citations[1].source).toBe('confluence');
  });

  it('deduplicates repeated citations', () => {
    const text = 'See [1] and also [1] again.';
    const citations = parseSynthesisResponse(text, sampleResults);
    expect(citations).toHaveLength(1);
  });
});

describe('synthesize', () => {
  it('calls LLM API and returns structured result', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'The pricing model was decided [1]. Details in docs [2].' }],
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const llmConfig: LlmConfig = {
      base_url: 'http://localhost:6655/anthropic/',
      auth_token: 'test-token',
      model: 'claude-haiku-latest',
    };

    const result = await synthesize('ECA pricing', sampleResults, llmConfig);
    expect(result.answer).toContain('pricing model');
    expect(result.citations).toHaveLength(2);

    vi.unstubAllGlobals();
  });
});
