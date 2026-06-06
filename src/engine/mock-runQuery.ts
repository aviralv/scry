// src/engine/mock-runQuery.ts
//
// Deterministic mock used by E2E tests. Gated by SCRY_SEARCH_MOCK=1 in the
// search route — never reachable from production code paths. Emits the same
// RunQueryEvent shape the real engine does, so the client/UI under test
// exercises the real rendering path with predictable input.

import type { RunQueryOptions, RunQueryEvent, SourceCard } from './types.js';

function makeCards(): SourceCard[] {
  return [
    {
      index: 1,
      source: 'slack',
      tool: 'slack_search',
      title: '#team-pricing',
      snippet: 'Discussion about Q3 pricing strategy and customer impact.',
      url: 'https://slack.example.com/archives/C1/p1',
      author: 'Sarah',
      timestamp: '2026-05-30T14:00:00Z',
      raw: null,
    },
    {
      index: 2,
      source: 'confluence-jira',
      tool: 'confluence_search',
      title: 'Pricing change RFC',
      snippet: 'Decision: phased rollout with customer notice 30 days prior.',
      url: 'https://confluence.example.com/x/pricing-rfc',
      author: 'rfc-bot',
      timestamp: '2026-05-29T10:00:00Z',
      raw: null,
    },
  ];
}

const MOCK_ANSWER = `**Status:** The team is iterating on the Q3 pricing change [1].

Key points:
- Phased rollout with **30-day customer notice** is the agreed plan [2].
- Sarah flagged customer-impact concerns in #team-pricing [1].

The RFC has been merged [2].`;

export async function* mockRunQuery(opts: RunQueryOptions): AsyncIterable<RunQueryEvent> {
  void opts;
  const sessionId = 'mock-session-fixed';
  const cards = makeCards();

  yield { type: 'session-init', sessionId };

  for (const card of cards) {
    yield { type: 'tool-call', tool: card.tool, args: { query: 'pricing' } };
    yield { type: 'tool-result', tool: card.tool, sourceIndex: card.index, source: card };
  }

  yield { type: 'assistant-text', text: MOCK_ANSWER };
  yield { type: 'sources-finalized', sources: cards };
  yield {
    type: 'done',
    sessionId,
    sources: cards,
    finalAnswer: MOCK_ANSWER,
  };
}
