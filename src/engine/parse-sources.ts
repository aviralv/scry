// src/engine/parse-sources.ts
import type { SourceCard } from './types.js';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Parse Claude's trailing "Sources:" enumeration into structured SourceCard[].
 *
 * Looks at only the LAST 2KB of the answer to avoid matching mid-prose [N]
 * patterns or fenced code blocks. Requires a `Sources:` (or `Source:`)
 * heading on its own line, followed by `[N]` lines.
 *
 * Returns empty array if no parseable block found — caller falls back to
 * streaming arrival-order list (see runQuery).
 */
export function parseSources(text: string): SourceCard[] {
  if (!text) return [];

  // Anchor to last 2KB to avoid mid-prose false positives.
  const tail = text.length > 2048 ? text.slice(-2048) : text;

  // Strip fenced code blocks before searching — content inside ``` is prose, not data.
  const stripped = tail.replace(/```[\s\S]*?```/g, '');

  // Find a line matching "Sources:" or "Source:" (case-insensitive).
  const headingMatch = stripped.match(/^Sources?\s*:\s*$/im);
  if (!headingMatch) return [];

  // Take everything after the heading.
  const after = stripped.slice(headingMatch.index! + headingMatch[0].length);

  // Iterate lines, parse those starting with [N].
  const sources: SourceCard[] = [];
  const lineRe = /^\s*\[(\d+)\]\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(after)) !== null) {
    const index = Number(m[1]);
    const rest = m[2].trim();
    const card = parseSourceLine(index, rest);
    if (card) sources.push(card);
  }

  return sources;
}

function parseSourceLine(index: number, rest: string): SourceCard | null {
  if (!rest) return null;

  // Match "<source>: <body>" prefix if present.
  const prefixed = rest.match(/^([^:]+):\s*(.*)$/);
  let source: string;
  let body: string;
  if (prefixed) {
    source = prefixed[1].trim();
    body = prefixed[2].trim();
  } else {
    source = 'unknown';
    body = rest;
  }

  // Try markdown-link form: [title](url)
  const mdLink = body.match(/^\[(.+?)\]\((\S+?)\)\s*(.*)$/);
  if (mdLink) {
    const title = mdLink[1].trim();
    const url = sanitizeUrl(mdLink[2]);
    return makeCard(index, source, title, url);
  }

  // Try title-with-trailing-(content) form — find the outermost trailing paren group.
  // Walk backward from end to find the matching open paren for the closing one.
  if (body.endsWith(')')) {
    const closeIdx = body.length - 1;
    let depth = 0;
    let openIdx = -1;
    for (let i = closeIdx; i >= 0; i--) {
      if (body[i] === ')') depth++;
      else if (body[i] === '(') {
        depth--;
        if (depth === 0) { openIdx = i; break; }
      }
    }
    if (openIdx > 0 && /\s$/.test(body.slice(0, openIdx))) {
      const parenContent = body.slice(openIdx + 1, closeIdx);
      const titlePart = body.slice(0, openIdx).trimEnd();
      if (titlePart.length > 0) {
        const possibleUrl = sanitizeUrl(parenContent);
        if (possibleUrl) {
          return makeCard(index, source, titlePart, possibleUrl);
        }
        // If the parens content looks like a URL attempt (has a scheme) but was
        // rejected by sanitizeUrl (bad scheme: javascript:, data:, file:),
        // strip it and use only the pre-parens portion as the title.
        if (/^[a-z][a-z0-9+.-]*:/i.test(parenContent)) {
          return makeCard(index, source, titlePart, undefined);
        }
        // The trailing parens were not a URL (e.g. an ID or note) — treat whole body as title.
        return makeCard(index, source, body, undefined);
      }
    }
  }

  // No URL — body is the title.
  return makeCard(index, source, body, undefined);
}

function sanitizeUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (!ALLOWED_SCHEMES.has(u.protocol)) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

function makeCard(index: number, source: string, title: string, url: string | undefined): SourceCard {
  return {
    index,
    source,
    tool: 'unknown',
    title,
    snippet: '',
    url,
    raw: null,
  };
}
