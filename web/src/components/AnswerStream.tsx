// web/src/components/AnswerStream.tsx
import { useMemo, type JSX } from 'react';

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

  // Split on [N] markers and render each non-marker segment as text + each marker as <sup>.
  const parts = useMemo(() => {
    const result: Array<{ kind: 'text'; value: string } | { kind: 'cite'; index: number }> = [];
    const re = /\[(\d+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(visibleText)) !== null) {
      if (m.index > last) {
        result.push({ kind: 'text', value: visibleText.slice(last, m.index) });
      }
      result.push({ kind: 'cite', index: Number(m[1]) });
      last = m.index + m[0].length;
    }
    if (last < visibleText.length) {
      result.push({ kind: 'text', value: visibleText.slice(last) });
    }
    return result;
  }, [visibleText]);

  return (
    <div className="answer-stream whitespace-pre-wrap text-text-primary">
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.value}</span>
        ) : (
          <sup
            key={i}
            data-cite={p.index}
            className="text-accent font-mono cursor-pointer mx-0.5"
            onMouseEnter={() => onCiteHover?.(p.index)}
            onMouseLeave={() => onCiteHover?.(null)}
            onClick={() => onCiteClick?.(p.index)}
          >
            [{p.index}]
          </sup>
        )
      )}
    </div>
  );
}
