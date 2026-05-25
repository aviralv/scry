import type { Citation, SourceCard } from './types.js';

interface ToolResultPayload {
  title: string;
  snippet: string;
  url?: string;
  author?: string;
  timestamp?: string;
  raw?: unknown;
}

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
      raw: payload.raw ?? null,
    };
    this.list.push(card);
    return card;
  }

  validateMarkers(text: string): Citation[] {
    const seen = new Set<number>();
    const cites: Citation[] = [];
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const idx = Number(m[1]);
      if (seen.has(idx)) continue;
      const card = this.list.find((s) => s.index === idx);
      if (!card) continue;
      seen.add(idx);
      cites.push({
        index: idx,
        source: card.source,
        title: card.title,
        url: card.url,
        author: card.author,
        timestamp: card.timestamp,
      });
    }
    return cites;
  }
}
