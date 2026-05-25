// tests/engine/parse-sources.test.ts
import { describe, it, expect } from 'vitest';
import { parseSources } from '../../src/engine/parse-sources.js';

describe('parseSources', () => {
  it('parses a basic mixed-source block (real shape from live test)', () => {
    const text = `Andre is pushing to ship by EOQ [1].

Sources:
[1] Confluence: 2026-05-21 EA Agent Consolidation discussion (10424680527)
[2] Slack: Marcus DM (May 20)
[3] Jira: NOVA-1054, ECO-1818`;
    const sources = parseSources(text);
    expect(sources.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(sources[0].source).toBe('Confluence');
    expect(sources[0].title).toContain('EA Agent Consolidation');
    expect(sources[1].source).toBe('Slack');
    expect(sources[2].source).toBe('Jira');
  });

  it('parses markdown-link variants', () => {
    const text = `Sources:
[1] Confluence: [2026-05-21 EA Agent](https://leanix.atlassian.net/x)`;
    const sources = parseSources(text);
    expect(sources[0].title).toBe('2026-05-21 EA Agent');
    expect(sources[0].url).toBe('https://leanix.atlassian.net/x');
  });

  it('parses URL in parens', () => {
    const text = `Sources:
[1] Slack: andre's msg (https://slack.com/x)`;
    expect(parseSources(text)[0].url).toBe('https://slack.com/x');
  });

  it('returns empty array when no Sources block', () => {
    expect(parseSources('Just an answer with [1] but no sources block')).toEqual([]);
  });

  it('returns empty array on empty input', () => {
    expect(parseSources('')).toEqual([]);
  });

  it('rejects javascript: URLs (XSS guard)', () => {
    const text = `Sources:
[1] Bad: title (javascript:alert(1))`;
    const sources = parseSources(text);
    expect(sources[0].url).toBeUndefined();
    expect(sources[0].title).toBe('title');
  });

  it('rejects data: and file: URLs', () => {
    const text = `Sources:
[1] Bad: title (data:text/html,evil)
[2] Bad: title (file:///etc/passwd)`;
    expect(parseSources(text)[0].url).toBeUndefined();
    expect(parseSources(text)[1].url).toBeUndefined();
  });

  it('does not match Sources: inside a fenced code block', () => {
    const text = `Some prose mentioning code:
\`\`\`
Sources:
[1] fake: nope
\`\`\`
Real content here.`;
    expect(parseSources(text)).toEqual([]);
  });

  it('does not match [1]: footnote-style mid-prose without trailing Sources heading', () => {
    const text = `One claim [1].
[1]: this is a definition not a sources list`;
    expect(parseSources(text)).toEqual([]);
  });

  it('preserves indices, does not renumber', () => {
    const text = `Sources:
[3] X: A
[7] Y: B`;
    const sources = parseSources(text);
    expect(sources.map((s) => s.index)).toEqual([3, 7]);
  });
});
