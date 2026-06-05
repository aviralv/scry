// web/src/components/AnswerStream.tsx
import { useMemo, type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import { createMarkdownComponents } from '../lib/markdown.js';

interface Props {
  text: string;
  stripEnumeration: boolean;
  onCiteHover?: (index: number | null) => void;
  onCiteClick?: (index: number) => void;
}

const SOURCES_HEADING_RE = /^Sources?\s*:\s*$/im;

export function AnswerStream({ text, stripEnumeration, onCiteHover, onCiteClick }: Props): JSX.Element {
  // Optionally strip everything from the last "Sources:" heading onward.
  // Only when caller signals the parser succeeded — never on failure.
  const visibleText = useMemo(() => {
    if (!stripEnumeration) return text;
    const tail = text.length > 2048 ? text.slice(-2048) : text;
    const m = tail.match(SOURCES_HEADING_RE);
    if (!m) return text;
    // The match index is relative to `tail`; convert to full-text index.
    const tailStart = text.length > 2048 ? text.length - 2048 : 0;
    const headingStart = tailStart + m.index!;
    return text.slice(0, headingStart).trimEnd();
  }, [text, stripEnumeration]);

  const components = useMemo(
    () => createMarkdownComponents(onCiteHover, onCiteClick),
    [onCiteHover, onCiteClick],
  );

  return (
    <div className="answer-stream text-text-primary">
      <ReactMarkdown components={components}>{visibleText}</ReactMarkdown>
    </div>
  );
}
