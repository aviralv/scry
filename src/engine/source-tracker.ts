import type { SourceCard } from './types.js';

interface ToolResultPayload {
  title: string;
  snippet: string;
  url?: string;
  author?: string;
  timestamp?: string;
}

/**
 * Accumulates SourceCards in the order they arrive from MCP tool_result blocks.
 * The 1-based `index` is what the model uses for `[N]` citations in its
 * synthesis. The tracker is also seeded with `priorSources` from prior turns
 * so a follow-up answer's citations resolve against the full session history.
 *
 * NOTE: this used to also expose `validateMarkers(text)` to drive a streaming
 * `citation` event during synthesis. The event was dead protocol traffic
 * (CLI ignored it; web's reducer did `return prev`); removed in PR C cleanup.
 * If progressive citation highlighting comes back, restore that helper from
 * git history rather than reimplementing.
 */
export class SourceTracker {
  private list: SourceCard[];

  constructor(prior: SourceCard[]) {
    this.list = [...prior];
  }

  get sources(): SourceCard[] {
    return [...this.list];
  }

  recordToolResult(server: string, tool: string, payload: ToolResultPayload): SourceCard {
    const card: SourceCard = {
      index: this.list.length + 1,
      source: server,
      tool,
      title: payload.title,
      snippet: payload.snippet,
      url: payload.url,
      author: payload.author,
      timestamp: payload.timestamp,
    };
    this.list.push(card);
    return card;
  }
}
