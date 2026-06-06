import { describe, it, expect } from 'vitest';
import { SourceTracker } from '../../src/engine/source-tracker.js';
import type { SourceCard } from '../../src/engine/types.js';

describe('SourceTracker', () => {
  it('starts empty when no priors given', () => {
    const t = new SourceTracker([]);
    expect(t.sources).toEqual([]);
  });

  it('assigns [1], [2], [3] in arrival order', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    t.recordToolResult('confluence-jira', 'confluence_search', { title: 'B', snippet: 'b' });
    t.recordToolResult('slack', 'slack_search', { title: 'C', snippet: 'c' });
    expect(t.sources.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(t.sources.map((s) => s.title)).toEqual(['A', 'B', 'C']);
  });

  it('continues numbering across follow-up turns when priors passed', () => {
    const prior: SourceCard[] = [
      { index: 1, source: 'slack', tool: 'slack_search', title: 'A', snippet: 'a' },
      { index: 2, source: 'confluence-jira', tool: 'confluence_search', title: 'B', snippet: 'b' },
    ];
    const t = new SourceTracker(prior);
    t.recordToolResult('slack', 'slack_search', { title: 'C', snippet: 'c' });
    expect(t.sources.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('returns a defensive copy from `sources` getter', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    const view = t.sources;
    view.push({ index: 99, source: 'evil', tool: 'evil', title: 'X', snippet: '' });
    expect(t.sources).toHaveLength(1);
  });
});
