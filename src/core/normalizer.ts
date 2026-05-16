import type { SearchResult } from '../config/types.js';

function extractJson(raw: string): string {
  const stripped = raw.replace(/^\[BEGIN UNTRUSTED CONTENT FROM [^\]]*\]\n?/, '').replace(/\n?\[END UNTRUSTED CONTENT[^\]]*\]$/, '');
  return stripped.trim();
}

export function normalizeSlackResults(raw: string): SearchResult[] {
  try {
    const data = JSON.parse(extractJson(raw));
    const matches = data?.messages?.matches ?? data?.messages ?? [];
    return matches.map((m: any) => ({
      source: 'slack' as const,
      title: `#${m.channel_name ?? m.channel?.name ?? 'unknown'}`,
      snippet: m.text ?? '',
      author: m.user ?? m.username ?? null,
      timestamp: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : '',
      url: m.permalink ?? null,
      metadata: {},
    }));
  } catch {
    return [];
  }
}

export function normalizeConfluenceResults(raw: string, baseUrl?: string): SearchResult[] {
  try {
    const data = JSON.parse(extractJson(raw));
    const results = data?.results ?? [];
    return results.map((r: any) => ({
      source: 'confluence' as const,
      title: r.content?.title ?? r.title ?? 'Untitled',
      snippet: stripHtml(r.excerpt ?? ''),
      author: null,
      timestamp: r.lastModified ?? '',
      url: baseUrl && r.content?._links?.webui
        ? `${baseUrl}${r.content._links.webui}`
        : r.content?._links?.webui ?? null,
      metadata: { space: r.resultGlobalContainer?.title ?? '' },
    }));
  } catch {
    return [];
  }
}

export function normalizeEmailResults(raw: string): SearchResult[] {
  try {
    const json = extractJson(raw);
    const data = JSON.parse(json);
    const messages = Array.isArray(data) ? data : data?.value ?? [];
    return messages.map((m: any) => ({
      source: 'email' as const,
      title: m.subject ?? 'No Subject',
      snippet: m.bodyPreview ?? '',
      author: m.from?.emailAddress?.name ?? null,
      timestamp: m.receivedDateTime ?? '',
      url: m.webLink ?? null,
      metadata: {},
    }));
  } catch {
    return [];
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
