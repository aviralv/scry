// web/src/components/TurnBlock.tsx
import { useState, type JSX } from 'react';
import type { SourceCard } from '@shared/types.js';
import { SourceRail } from './SourceRail.js';
import { AnswerStream } from './AnswerStream.js';
import { StatusPip } from './StatusPip.js';

interface Props {
  query: string;
  cards: SourceCard[];
  finalAnswer: string;
  finalized: boolean;
  activeTools: string[];
  showDivider: boolean;
  turnIndex: number;
}

export function TurnBlock({
  query,
  cards,
  finalAnswer,
  finalized,
  activeTools,
  showDivider,
  turnIndex,
}: Props): JSX.Element {
  const [highlighted, setHighlighted] = useState<number | undefined>(undefined);

  return (
    <div className="turn-block">
      {showDivider && (
        <div className="my-6 border-t border-border" aria-hidden="true" />
      )}
      <div className="text-text-tertiary text-xs font-mono mb-2">
        Turn {turnIndex + 1}: <span className="text-text-secondary">{query}</span>
      </div>
      <SourceRail cards={cards} highlightedIndex={highlighted} turnIndex={turnIndex} />
      {activeTools.length > 0 && (
        <div className="mb-4">
          {activeTools.map((t, i) => <StatusPip key={i} tool={t} />)}
        </div>
      )}
      <AnswerStream
        text={finalAnswer}
        stripEnumeration={finalized}
        onCiteHover={(idx) => setHighlighted(idx ?? undefined)}
        onCiteClick={(idx) => {
          // Scroll to a card scoped to THIS turn — id includes turnIndex.
          const el = document.getElementById(`source-card-${turnIndex}-${idx}`);
          el?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
        }}
      />
    </div>
  );
}
