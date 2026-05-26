// web/src/components/SourceRail.tsx
import type { JSX } from 'react';
import type { SourceCard as SourceCardData } from '@shared/types.js';
import { SourceCard } from './SourceCard.js';

interface Props {
  cards: SourceCardData[];
  highlightedIndex?: number;
}

export function SourceRail({ cards, highlightedIndex }: Props): JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <div className="source-rail flex gap-2 overflow-x-auto py-2 mb-4">
      {cards.map((c) => (
        <SourceCard key={c.index} card={c} highlighted={c.index === highlightedIndex} />
      ))}
    </div>
  );
}
