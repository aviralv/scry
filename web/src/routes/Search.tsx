// web/src/routes/Search.tsx
import { useState, useRef, useCallback, type JSX } from 'react';
import type { RunQueryEvent, SourceCard } from '@shared/types.js';
import { apiFetch } from '../lib/api.js';
import { consumeStream } from '../lib/stream.js';
import { SearchInput } from '../components/SearchInput.js';
import { SourceRail } from '../components/SourceRail.js';
import { AnswerStream } from '../components/AnswerStream.js';
import { StatusPip } from '../components/StatusPip.js';

// Stream events from POST /api/search are RunQueryEvent OR a transport-only
// keepalive heartbeat. Keepalive is filtered before reducer logic.
type StreamEvent = RunQueryEvent | { type: 'keepalive' };

type State =
  | { kind: 'empty' }
  | { kind: 'submitting' }
  | { kind: 'streaming'; sessionId?: string; activeTools: string[]; cards: SourceCard[]; finalAnswer: string; finalized: boolean }
  | { kind: 'done'; cards: SourceCard[]; finalAnswer: string; finalized: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'aborted'; cards: SourceCard[]; finalAnswer: string; finalized: boolean };

export function Search(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'empty' });
  const [highlighted, setHighlighted] = useState<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(async (query: string, fanoutMode: boolean) => {
    setState({ kind: 'submitting' });
    const ctl = new AbortController();
    abortRef.current = ctl;

    let res: Response;
    try {
      res = await apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({ query, fanoutMode }),
        signal: ctl.signal,
      });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message ?? 'fetch failed' });
      return;
    }

    if (!res.ok) {
      setState({ kind: 'error', message: `HTTP ${res.status}` });
      return;
    }

    setState({
      kind: 'streaming',
      sessionId: undefined,
      activeTools: [],
      cards: [],
      finalAnswer: '',
      finalized: false,
    });

    await consumeStream<StreamEvent>(res, {
      onEvent: (event) => {
        if (event.type === 'keepalive') return;
        setState((prev) => {
          if (prev.kind !== 'streaming') return prev;
          switch (event.type) {
            case 'session-init':
              return { ...prev, sessionId: event.sessionId };
            case 'tool-call':
              return { ...prev, activeTools: [...prev.activeTools, event.tool] };
            case 'tool-result':
              return {
                ...prev,
                activeTools: prev.activeTools.filter((t) => t !== event.tool),
                cards: prev.finalized ? prev.cards : [...prev.cards, event.source],
              };
            case 'assistant-text':
              return { ...prev, finalAnswer: prev.finalAnswer + event.text };
            case 'sources-finalized':
              return { ...prev, cards: event.sources, finalized: true };
            case 'done':
              return {
                kind: 'done',
                cards: prev.finalized ? prev.cards : event.sources,
                finalAnswer: prev.finalAnswer,
                finalized: prev.finalized,
              };
            case 'error':
              return { kind: 'error', message: event.message };
            case 'citation':
              return prev;
          }
        });
      },
      onError: (err) => {
        setState({ kind: 'error', message: err.message ?? String(err) });
      },
    }, ctl.signal);
  }, []);

  const handleNewSearch = () => {
    abortRef.current?.abort();
    setState({ kind: 'empty' });
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setState((prev) =>
      prev.kind === 'streaming'
        ? { kind: 'aborted', cards: prev.cards, finalAnswer: prev.finalAnswer, finalized: prev.finalized }
        : prev,
    );
  };

  const showRail = state.kind === 'streaming' || state.kind === 'done' || state.kind === 'aborted';

  return (
    <div className="search-page p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-sans text-text-primary mb-4">
        <span className="text-accent">s</span>cry
      </h1>

      {(state.kind === 'empty' || state.kind === 'error' || state.kind === 'aborted') && (
        <SearchInput onSubmit={handleSubmit} />
      )}

      {state.kind === 'submitting' && (
        <div className="text-text-tertiary text-sm">Connecting…</div>
      )}

      {showRail && (
        <>
          <SourceRail cards={state.cards} highlightedIndex={highlighted} />
          {state.kind === 'streaming' && state.activeTools.length > 0 && (
            <div className="mb-4">
              {state.activeTools.map((t, i) => <StatusPip key={i} tool={t} />)}
            </div>
          )}
          <AnswerStream
            text={state.finalAnswer}
            stripEnumeration={state.finalized}
            onCiteHover={(idx) => setHighlighted(idx ?? undefined)}
            onCiteClick={(idx) => {
              const el = document.getElementById(`source-card-${idx}`);
              el?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
            }}
          />
        </>
      )}

      {state.kind === 'streaming' && (
        <button
          type="button"
          onClick={handleStop}
          className="mt-4 px-3 py-1 rounded border border-border text-text-secondary hover:bg-bg-secondary text-sm"
        >
          Stop
        </button>
      )}

      {(state.kind === 'done' || state.kind === 'aborted') && (
        <button
          type="button"
          onClick={handleNewSearch}
          className="mt-4 px-3 py-1 rounded border border-accent-dim text-accent hover:bg-bg-secondary text-sm"
        >
          New search
        </button>
      )}

      {state.kind === 'error' && (
        <div className="mt-4 p-3 rounded border border-error bg-bg-secondary text-error">
          {state.message}
        </div>
      )}
    </div>
  );
}
