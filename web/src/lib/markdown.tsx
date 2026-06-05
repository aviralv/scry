// web/src/lib/markdown.tsx
//
// Citation-preserving markdown rendering for AnswerStream.
//
// The synthesized answer is markdown with `[N]` citation markers sprinkled
// inside text, including inside emphasis, lists, and headings (e.g. `**Status:
// Resolved [3]**`). react-markdown turns markdown into a React tree; we
// override every text-bearing component to deep-walk its children, and any
// string child gets split on `[N]` so the citations render as interactive
// `<sup>` elements wherever they appear.
//
// `splitCitations` is exported as a pure helper for unit tests.
//
// `a` is overridden to run hrefs through `sanitizeUrl` — same scheme policy
// as SourceCard. Rejected URLs render as plain text. New-tab links carry a
// visually-hidden announcement so screen-reader users hear the behavior.
//
// `code` is intentionally NOT overridden — bracket notation in code spans
// (e.g. `array[1]`) must render verbatim, not as a citation.
//
// `img` is explicitly disabled — the LLM never produces image markdown today,
// and forbidding it now closes a future XSS vector (e.g. `data:image/svg+xml`
// with embedded script) without affecting any current rendering.

import { Children, type KeyboardEvent, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { sanitizeUrl } from './sanitize.js';

export type CiteHover = (index: number | null) => void;
export type CiteClick = (index: number) => void;

// Source pattern only — every call constructs a fresh global regex from
// `.source` so module-level `lastIndex` state can never leak.
const CITE_RE_SOURCE = '\\[(\\d+)\\]';

/**
 * Split a string into text and citation nodes. `[N]` markers become `<sup>`
 * elements with hover/click handlers and Enter/Space activation; surrounding
 * text is kept verbatim.
 *
 * Pure and synchronous — safe to use in render. Returns ReactNode[] always
 * (caller decides whether to wrap or splice).
 */
export function splitCitations(
  text: string,
  keyPrefix: string,
  onCiteHover?: CiteHover,
  onCiteClick?: CiteClick,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = new RegExp(CITE_RE_SOURCE, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const idx = Number(m[1]);
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCiteClick?.(idx);
      }
    };
    parts.push(
      <sup
        key={`${keyPrefix}-${m.index}`}
        data-cite={idx}
        role="button"
        tabIndex={0}
        aria-label={`Citation ${idx}`}
        className="text-accent font-mono cursor-pointer mx-0.5 focus:outline-none focus:ring-2 focus:ring-accent rounded"
        onMouseEnter={() => onCiteHover?.(idx)}
        onMouseLeave={() => onCiteHover?.(null)}
        onFocus={() => onCiteHover?.(idx)}
        onBlur={() => onCiteHover?.(null)}
        onClick={() => onCiteClick?.(idx)}
        onKeyDown={onKeyDown}
      >
        [{idx}]
      </sup>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Walk the children of a markdown component and split strings on citation
 * markers. Non-string nodes (other React elements) pass through unchanged —
 * their own component overrides handle their inner strings.
 */
function walkChildrenForCitations(
  children: ReactNode,
  keyPrefix: string,
  onCiteHover?: CiteHover,
  onCiteClick?: CiteClick,
): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(children, (child, i) => {
    if (typeof child === 'string') {
      out.push(...splitCitations(child, `${keyPrefix}-${i}`, onCiteHover, onCiteClick));
    } else {
      out.push(child);
    }
  });
  return out;
}

/**
 * Build a `components` map for react-markdown that:
 *   1. Replaces `[N]` markers with citation `<sup>` elements at any depth.
 *   2. Sanitizes anchor hrefs (rejects javascript:/data:/file:/etc.).
 *   3. Disables image rendering.
 */
export function createMarkdownComponents(
  onCiteHover?: CiteHover,
  onCiteClick?: CiteClick,
): Components {
  // Tags that contain text and need citation walking. We override each
  // explicitly so the default react-markdown renderer doesn't bypass us
  // on nested elements (e.g. a `<strong>` inside a `<p>`).
  //
  // `code` is deliberately omitted — bracket notation inside code spans
  // (e.g. `array[1]`) must render verbatim, not as a citation marker.
  const wrap = (Tag: keyof JSX.IntrinsicElements) =>
    function MarkdownNode({ node: _node, children, ...rest }: any) {
      const walked = walkChildrenForCitations(children, Tag as string, onCiteHover, onCiteClick);
      return <Tag {...rest}>{walked}</Tag>;
    };

  return {
    p: wrap('p'),
    li: wrap('li'),
    strong: wrap('strong'),
    em: wrap('em'),
    h1: wrap('h1'),
    h2: wrap('h2'),
    h3: wrap('h3'),
    h4: wrap('h4'),
    h5: wrap('h5'),
    h6: wrap('h6'),
    blockquote: wrap('blockquote'),
    td: wrap('td'),
    th: wrap('th'),
    // Suppress image rendering. react-markdown would otherwise emit a raw
    // <img>; an attacker who can shape the synthesized answer could point
    // it at data: URLs or external trackers. Disabling outright is the
    // safest default; re-enable with a sanitized loader if/when needed.
    img: () => null,
    a: function MarkdownAnchor({ node: _node, href, children, ...rest }: any) {
      const safe = sanitizeUrl(typeof href === 'string' ? href : undefined);
      const walked = walkChildrenForCitations(children, 'a', onCiteHover, onCiteClick);
      if (!safe) {
        // Drop the unsafe href but keep the text.
        return <span {...rest}>{walked}</span>;
      }
      return (
        <a {...rest} href={safe} target="_blank" rel="noreferrer noopener">
          {walked}
          {/* WCAG 3.2.2: announce that the link opens a new tab. */}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    },
  };
}
