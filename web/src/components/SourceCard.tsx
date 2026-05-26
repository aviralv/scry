// web/src/components/SourceCard.tsx
import type { JSX } from 'react';
import type { SourceCard as SourceCardData } from '@shared/types.js';
import { sanitizeUrl } from '../lib/sanitize.js';

interface Props {
  card: SourceCardData;
  highlighted?: boolean;
}

export function SourceCard({ card, highlighted }: Props): JSX.Element {
  const url = sanitizeUrl(card.url);
  const className = [
    'source-card',
    'rounded border border-border p-2 min-w-[10rem] max-w-[14rem] flex-shrink-0',
    'bg-bg-elevated text-text-primary text-sm',
    'transition-colors duration-150',
    highlighted ? 'ring-2 ring-accent' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-text-tertiary">[{card.index}]</span>
        <span className="font-mono text-xs text-accent">{card.source}</span>
      </div>
      <div className="text-text-primary text-sm mt-1 line-clamp-2">{card.title}</div>
      {card.author && (
        <div className="text-text-tertiary text-xs mt-1">{card.author}</div>
      )}
    </>
  );

  if (url) {
    return (
      <a
        id={`source-card-${card.index}`}
        className={className + ' hover:bg-bg-secondary cursor-pointer'}
        href={url}
        target="_blank"
        rel="noreferrer noopener"
      >
        {content}
      </a>
    );
  }
  return (
    <div id={`source-card-${card.index}`} className={className}>
      {content}
    </div>
  );
}
