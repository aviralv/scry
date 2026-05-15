import { describe, it, expect } from 'vitest';
import { normalizeSlackResults, normalizeConfluenceResults, normalizeEmailResults } from '../../src/core/normalizer.js';

describe('normalizeSlackResults', () => {
  it('extracts messages from slack_search JSON response', () => {
    const raw = JSON.stringify({
      messages: {
        matches: [
          {
            text: 'We decided on per-document pricing',
            username: 'marcus.karlbowski',
            ts: '1714924800',
            channel: { name: 'team-nova-internal' },
            permalink: 'https://leanix.slack.com/archives/C123/p1714924800',
          },
        ],
      },
    });

    const results = normalizeSlackResults(raw);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('slack');
    expect(results[0].snippet).toBe('We decided on per-document pricing');
    expect(results[0].author).toBe('marcus.karlbowski');
    expect(results[0].url).toBe('https://leanix.slack.com/archives/C123/p1714924800');
  });

  it('returns empty array on invalid JSON', () => {
    expect(normalizeSlackResults('not json')).toHaveLength(0);
  });
});

describe('normalizeConfluenceResults', () => {
  it('extracts pages from confluence_search JSON response', () => {
    const raw = JSON.stringify({
      results: [
        {
          content: {
            id: '12345',
            title: 'ECA Pricing Strategy',
            _links: { webui: '/spaces/NOVA/pages/12345' },
          },
          excerpt: 'The pricing model for ECA will be...',
          lastModified: '2026-05-05T10:00:00.000Z',
          resultGlobalContainer: { title: 'NOVA' },
        },
      ],
    });

    const results = normalizeConfluenceResults(raw, 'https://leanix.atlassian.net/wiki');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('confluence');
    expect(results[0].title).toBe('ECA Pricing Strategy');
    expect(results[0].url).toContain('/spaces/NOVA/pages/12345');
  });
});

describe('normalizeEmailResults', () => {
  it('extracts messages from outlook_list_messages JSON response', () => {
    const raw = JSON.stringify({
      value: [
        {
          subject: 'Re: ECA pricing follow-up',
          bodyPreview: 'I think the tiered model makes sense...',
          from: { emailAddress: { name: 'Marcus Karlbowski', address: 'marcus.karlbowski@sap.com' } },
          receivedDateTime: '2026-05-06T14:30:00Z',
          webLink: 'https://outlook.office365.com/owa/?ItemID=AAA123',
        },
      ],
    });

    const results = normalizeEmailResults(raw);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('email');
    expect(results[0].title).toBe('Re: ECA pricing follow-up');
    expect(results[0].author).toBe('Marcus Karlbowski');
  });
});
