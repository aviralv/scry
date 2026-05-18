import type { SearchResult } from '../config/types.js';

export type NormalizerFn = (raw: string, source?: string) => SearchResult[];

function extractJson(raw: string): string {
  const stripped = raw.replace(/^\[BEGIN UNTRUSTED CONTENT FROM [^\]]*\]\n?/, '').replace(/\n?\[END UNTRUSTED CONTENT[^\]]*\]$/, '');
  return stripped.trim();
}

export function normalizeSlackResults(raw: string, source: string = 'slack'): SearchResult[] {
  try {
    const data = JSON.parse(extractJson(raw));
    const matches = data?.messages?.matches ?? data?.messages ?? [];
    return matches.map((m: any) => ({
      source,
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

export function normalizeConfluenceResults(raw: string, baseUrl?: string, source: string = 'confluence'): SearchResult[] {
  try {
    const data = JSON.parse(extractJson(raw));
    const results = data?.results ?? [];
    return results.map((r: any) => ({
      source,
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

export function normalizeEmailResults(raw: string, source: string = 'email'): SearchResult[] {
  try {
    const json = extractJson(raw);
    const data = JSON.parse(json);
    const messages = Array.isArray(data) ? data : data?.value ?? [];
    return messages.map((m: any) => ({
      source,
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

export function normalizeGeneric(raw: string, source: string = 'unknown'): SearchResult[] {
  try {
    const json = extractJson(raw);
    const data = JSON.parse(json);
    const items: any[] = Array.isArray(data)
      ? data
      : data?.results ?? data?.value ?? data?.items ?? data?.messages ?? [];

    if (!Array.isArray(items)) return [];

    return items.map((item: any) => ({
      source,
      title: item.title ?? item.subject ?? item.name ?? '',
      snippet: item.text ?? item.snippet ?? item.body ?? item.bodyPreview ?? item.summary ?? item.excerpt ?? '',
      author: item.author ?? item.user ?? item.username ?? item.from?.emailAddress?.name ?? null,
      timestamp: item.ts ? new Date(Number(item.ts) * 1000).toISOString() : item.date ?? item.receivedDateTime ?? item.lastModified ?? '',
      url: item.url ?? item.permalink ?? item.webLink ?? item.link ?? null,
      metadata: {},
      confidence: 'low' as const,
    }));
  } catch {
    return [];
  }
}

export const normalizerRegistry = new Map<string, NormalizerFn>([
  ['slack', normalizeSlackResults],
  ['confluence', (raw: string, source?: string) => normalizeConfluenceResults(raw, undefined, source)],
  ['email', normalizeEmailResults],
  ['generic', normalizeGeneric],
]);

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
