import { describe, it, expect } from 'vitest';
import { normalizeSlackResults, normalizeConfluenceResults, normalizeEmailResults, normalizerRegistry, normalizeGeneric } from '../../src/core/normalizer.js';

describe('normalizeSlackResults', () => {
  it('extracts messages from nested matches format', () => {
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

  it('extracts messages from flat messages array (MCP server format)', () => {
    const raw = '[BEGIN UNTRUSTED CONTENT FROM Slack]\n' + JSON.stringify({
      messages: [
        {
          text: 'ECA rename is done',
          user: 'muhammad.faisal',
          ts: '1777032880.130489',
          channel_name: 'team-nova-internal',
          permalink: 'https://leanix.slack.com/archives/C06JC8DATN3/p1777032880130489',
        },
      ],
    }) + '\n[END UNTRUSTED CONTENT FROM Slack]';

    const results = normalizeSlackResults(raw);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('#team-nova-internal');
    expect(results[0].author).toBe('muhammad.faisal');
    expect(results[0].snippet).toBe('ECA rename is done');
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

  it('handles untrusted content wrapper', () => {
    const raw = '[BEGIN UNTRUSTED CONTENT FROM Confluence search]\n' + JSON.stringify({
      results: [{ content: { title: 'Test Page', _links: { webui: '/spaces/X/pages/1' } }, excerpt: 'test', lastModified: '2026-01-01', resultGlobalContainer: { title: 'X' } }],
    }) + '\n[END UNTRUSTED CONTENT FROM Confluence search]';

    const results = normalizeConfluenceResults(raw);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Test Page');
  });
});

describe('normalizeEmailResults', () => {
  it('extracts messages from { value: [...] } format', () => {
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

  it('extracts messages from flat array format (MCP server format)', () => {
    const raw = '[BEGIN UNTRUSTED CONTENT FROM Microsoft 365]\n' + JSON.stringify([
      {
        subject: 'Re: DB - LeanIX',
        bodyPreview: 'Hi René, Schön dass ihr dabei seid!',
        from: { emailAddress: { name: 'Mewes, Gerrit', address: 'gerrit.mewes@sap.com' } },
        receivedDateTime: '2026-04-30T10:32:07Z',
      },
    ]) + '\n[END UNTRUSTED CONTENT FROM Microsoft 365]';

    const results = normalizeEmailResults(raw);
    expect(results).toHaveLength(1);
    expect(results[0].author).toBe('Mewes, Gerrit');
    expect(results[0].title).toBe('Re: DB - LeanIX');
  });
});

describe('normalizerRegistry', () => {
  it('contains slack, confluence, email keys', () => {
    expect(normalizerRegistry.get('slack')).toBeDefined();
    expect(normalizerRegistry.get('confluence')).toBeDefined();
    expect(normalizerRegistry.get('email')).toBeDefined();
  });
});

describe('normalizeGeneric', () => {
  it('extracts items from array response with low confidence', () => {
    const raw = JSON.stringify([
      { title: 'Item 1', text: 'Some content', url: 'https://example.com/1' },
    ]);
    const results = normalizeGeneric(raw, 'custom-source');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('custom-source');
    expect(results[0].title).toBe('Item 1');
    expect(results[0].snippet).toBe('Some content');
    expect(results[0].confidence).toBe('low');
  });

  it('extracts items from { results: [...] } wrapper', () => {
    const raw = JSON.stringify({ results: [{ title: 'Page', summary: 'A page' }] });
    const results = normalizeGeneric(raw, 'wiki');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Page');
  });

  it('handles untrusted content wrapper', () => {
    const raw = '[BEGIN UNTRUSTED CONTENT FROM Custom]\n' +
      JSON.stringify([{ title: 'Test' }]) +
      '\n[END UNTRUSTED CONTENT FROM Custom]';
    const results = normalizeGeneric(raw, 'custom');
    expect(results).toHaveLength(1);
  });

  it('returns empty for completely unparseable content', () => {
    expect(normalizeGeneric('not json at all', 'x')).toEqual([]);
  });
});
