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
      { index: 1, source: 'slack', tool: 'slack_search', title: 'A', snippet: 'a', raw: {} },
      { index: 2, source: 'confluence-jira', tool: 'confluence_search', title: 'B', snippet: 'b', raw: {} },
    ];
    const t = new SourceTracker(prior);
    t.recordToolResult('slack', 'slack_search', { title: 'C', snippet: 'c' });
    expect(t.sources.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('validateMarkers returns citations for known indices', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    t.recordToolResult('slack', 'slack_search', { title: 'B', snippet: 'b' });
    const cits = t.validateMarkers('Andre said X [1] but Dimitri disagreed [2]');
    expect(cits.map((c) => c.index)).toEqual([1, 2]);
  });

  it('drops unmapped indices', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    expect(t.validateMarkers('claim [99]')).toEqual([]);
  });

  it('deduplicates repeated indices in one text', () => {
    const t = new SourceTracker([]);
    t.recordToolResult('slack', 'slack_search', { title: 'A', snippet: 'a' });
    const cits = t.validateMarkers('says [1] and again [1]');
    expect(cits.length).toBe(1);
  });
});
