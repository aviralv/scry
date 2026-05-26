// web/src/routes/Search.tsx
import { useState, useRef, useCallback, type JSX } from 'react';
import type { RunQueryEvent, SourceCard } from '@shared/types.js';
import { apiFetch } from '../lib/api.js';
import { consumeStream } from '../lib/stream.js';
import { SearchInput } from '../components/SearchInput.js';
import { TurnBlock } from '../components/TurnBlock.js';

type StreamEvent = RunQueryEvent | { type: 'keepalive' };

interface TurnData {
  query: string;
  cards: SourceCard[];
  finalAnswer: string;
  finalized: boolean;
  activeTools: string[];
}

type State =
  | { kind: 'empty' }
  | { kind: 'submitting'; turns: TurnData[]; sessionId?: string }
  | { kind: 'streaming'; turns: TurnData[]; sessionId?: string }
  | { kind: 'done'; turns: TurnData[]; sessionId: string }
  | { kind: 'error'; turns: TurnData[]; sessionId?: string; message: string }
  | { kind: 'aborted'; turns: TurnData[]; sessionId?: string };

function newTurn(query: string): TurnData {
  return { query, cards: [], finalAnswer: '', finalized: false, activeTools: [] };
}

export function Search(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'empty' });
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(async (query: string, fanoutMode: boolean) => {
    // Capture current sessionId + turns before mutating state.
    const carrySession =
      state.kind === 'done' || state.kind === 'aborted' || state.kind === 'error'
        ? state.sessionId
        : undefined;
    const carryTurns =
      state.kind === 'done' || state.kind === 'aborted' || state.kind === 'error'
        ? state.turns
        : [];

    const ctl = new AbortController();
    abortRef.current = ctl;

    setState({
      kind: 'submitting',
      turns: [...carryTurns, newTurn(query)],
      sessionId: carrySession,
    });

    let res: Response;
    try {
      res = await apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          fanoutMode,
          ...(carrySession ? { sessionId: carrySession } : {}),
        }),
        signal: ctl.signal,
      });
    } catch (err) {
      setState((prev) => ({
        kind: 'error',
        turns: prev.kind === 'empty' ? [] : prev.turns,
        sessionId: prev.kind === 'empty' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
        message: (err as Error).message ?? 'fetch failed',
      }));
      return;
    }

    if (!res.ok) {
      setState((prev) => ({
        kind: 'error',
        turns: prev.kind === 'empty' ? [] : prev.turns,
        sessionId: prev.kind === 'empty' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
        message: `HTTP ${res.status}`,
      }));
      return;
    }

    setState((prev) => ({
      kind: 'streaming',
      turns: prev.kind === 'empty' ? [newTurn(query)] : prev.turns,
      sessionId: prev.kind === 'empty' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
    }));

    await consumeStream<StreamEvent>(res, {
      onEvent: (event) => {
        if (event.type === 'keepalive') return;
        setState((prev) => {
          if (prev.kind !== 'streaming') return prev;
          // Always mutate the LAST turn — that's the active one.
          const turns = [...prev.turns];
          const lastIdx = turns.length - 1;
          const last = turns[lastIdx];
          switch (event.type) {
            case 'session-init':
              return { ...prev, sessionId: event.sessionId };
            case 'tool-call':
              turns[lastIdx] = { ...last, activeTools: [...last.activeTools, event.tool] };
              return { ...prev, turns };
            case 'tool-result':
              turns[lastIdx] = {
                ...last,
                activeTools: last.activeTools.filter((t) => t !== event.tool),
                cards: last.finalized ? last.cards : [...last.cards, event.source],
              };
              return { ...prev, turns };
            case 'assistant-text':
              turns[lastIdx] = { ...last, finalAnswer: last.finalAnswer + event.text };
              return { ...prev, turns };
            case 'sources-finalized':
              turns[lastIdx] = { ...last, cards: event.sources, finalized: true };
              return { ...prev, turns };
            case 'done':
              turns[lastIdx] = {
                ...last,
                cards: last.finalized ? last.cards : event.sources,
                finalAnswer: last.finalAnswer,
                finalized: last.finalized,
              };
              return { kind: 'done', turns, sessionId: event.sessionId };
            case 'error':
              return { kind: 'error', turns: prev.turns, sessionId: prev.sessionId, message: event.message };
            case 'citation':
              return prev;
          }
        });
      },
      onError: (err) => {
        setState((prev) => ({
          kind: 'error',
          turns: prev.kind === 'empty' ? [] : prev.turns,
          sessionId: prev.kind === 'empty' ? undefined : ('sessionId' in prev ? prev.sessionId : undefined),
          message: err.message ?? String(err),
        }));
      },
    }, ctl.signal);
  }, [state]);

  const handleNewSearch = () => {
    abortRef.current?.abort();
    setState({ kind: 'empty' });
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setState((prev) =>
      prev.kind === 'streaming'
        ? { kind: 'aborted', turns: prev.turns, sessionId: prev.sessionId }
        : prev,
    );
  };

  const turns = state.kind === 'empty' ? [] : state.turns;
  const showInput =
    state.kind === 'empty' || state.kind === 'done' || state.kind === 'error' || state.kind === 'aborted';
  const showStop = state.kind === 'streaming';
  const showNewSearchBtn = state.kind === 'done' || state.kind === 'aborted' || state.kind === 'error';
  const showReloadNotice = turns.length > 1;

  return (
    <div className="search-page p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-sans text-text-primary mb-6">
        <span className="text-accent">s</span>cry
      </h1>

      {turns.map((t, i) => (
        <TurnBlock
          key={i}
          query={t.query}
          cards={t.cards}
          finalAnswer={t.finalAnswer}
          finalized={t.finalized}
          activeTools={t.activeTools}
          showDivider={i > 0}
          turnIndex={i}
        />
      ))}

      {state.kind === 'submitting' && (
        <div className="text-text-tertiary text-sm mt-4">Connecting…</div>
      )}

      {state.kind === 'error' && (
        <div className="mt-4 p-3 rounded border border-error bg-bg-secondary text-error">
          {state.message}
        </div>
      )}

      {showInput && (
        <div className="mt-6">
          <SearchInput onSubmit={handleSubmit} />
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {showStop && (
          <button
            type="button"
            onClick={handleStop}
            className="px-3 py-1 rounded border border-border text-text-secondary hover:bg-bg-secondary text-sm"
          >
            Stop
          </button>
        )}
        {showNewSearchBtn && (
          <button
            type="button"
            onClick={handleNewSearch}
            className="px-3 py-1 rounded border border-accent-dim text-accent hover:bg-bg-secondary text-sm"
          >
            New search
          </button>
        )}
      </div>

      {showReloadNotice && (
        <div className="mt-8 text-text-tertiary text-xs italic">
          ⓘ Reload loses state — Plan C3 adds persistence.
        </div>
      )}
    </div>
  );
}
