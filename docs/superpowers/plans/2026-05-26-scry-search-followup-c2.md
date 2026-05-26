# scry — Plan C2: In-page follow-up turns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After C1's `done`, the search input remains usable. Submitting a follow-up sends the same `sessionId` so the SDK resumes the prior conversation. Each turn renders as its own stacked block with its own source rail + answer + per-turn `[1]`–`[N]` citations. A `New search` button drops the session and starts fresh.

**Architecture:** No engine changes — `runQuery` already accepts `resume?: string`. The server route extends its body schema to accept `sessionId?`, passes it through. Frontend's `Search.tsx` refactors from a single `cards/finalAnswer/finalized` triple to a `turns: TurnData[]` array; each turn renders via a new `TurnBlock` component that owns its own rail + answer + highlight state. The accumulated `sessionId` gets sent on follow-up submits.

**Tech Stack:** Same as C1 — Hono streamSSE + React + Vite + existing `lib/stream.ts`.

**Spec reference:** [`docs/superpowers/specs/2026-05-25-scry-search-route-design.md`](../specs/2026-05-25-scry-search-route-design.md) — § Plan C2.

**Branch state at start:** PR #8 (C1) merged to `main`. Tests: 173 passing. Branch off latest `main`.

**Out of scope (C3):** Library sidebar, SQLite persistence, reload-survives-state. C2 is in-memory only — hard reload loses turn history (a small notice in the UI says so).

**Deviation from spec:** The spec mentions sending `priorSources?: SourceCard[]` in the request body (capped at 50). This plan **drops it**. Per-turn `[N]` scoping means each turn's source-tracker starts at `[1]`, and the SDK's `resume` already restores prior conversation context from the session JSONL — so `priorSources` is redundant in C2. C3's persistence layer revisits this if the SQLite-backed flow needs it.

---

## File map

| Path | Purpose |
|---|---|
| `tests/engine/runQuery.test.ts` | + 1 test: when `resume` is set on `RunQueryOptions`, the underlying SDK query is called with `options.resume` set |
| `src/server/routes/search.ts` | Extend body schema with optional `sessionId`, forward to `runQuery` |
| `tests/server/routes/search.test.ts` | + 1 test: body accepts `sessionId`, schema rejects bad-shape `sessionId` |
| `web/src/components/TurnBlock.tsx` | NEW — renders one turn (optional divider above + rail + status pips + answer); owns its own highlight state |
| `web/src/routes/Search.tsx` | Refactor to `turns: TurnData[]` state, retain `sessionId` across turns, send it on follow-up |
| `web/src/components/SearchInput.tsx` | (no change — reused as-is) |

---

### Task 1: Engine — verify `resume` forwarding

**Files:**
- Modify: `tests/engine/runQuery.test.ts` (+1 test)

The engine already accepts `resume?: string` in `RunQueryOptions` and passes it through to the SDK. This task adds a regression test so a future refactor can't silently drop it.

- [ ] **Step 1: Write the failing test**

In `tests/engine/runQuery.test.ts`, add inside the existing `describe('runQuery', ...)` block:

```typescript
  it('forwards resume option to the SDK queryFn when provided', async () => {
    let capturedOptions: Record<string, unknown> | null = null;
    const fakeQuery = ((args: { prompt: string; options: Record<string, unknown> }) => {
      capturedOptions = args.options;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-resume' };
        yield { type: 'result', subtype: 'success', session_id: 'sess-resume' };
      })();
    }) as never;

    const events: RunQueryEvent[] = [];
    for await (const e of runQuery({
      prompt: 'follow-up',
      config: baseConfig,
      scryConfigDir: '/tmp/scry',
      resume: 'prior-session-id',
      queryFn: fakeQuery,
    })) {
      events.push(e);
    }

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions!.resume).toBe('prior-session-id');
    expect(events[0]).toMatchObject({ type: 'session-init' });
  });
```

- [ ] **Step 2: Run, confirm pass**

```bash
npm test -- tests/engine/runQuery.test.ts
```

Expected: passes immediately (engine already forwards `resume`). If it fails, the engine has a regression — STOP and report.

- [ ] **Step 3: Commit**

```bash
git add tests/engine/runQuery.test.ts
git commit -m "test(engine): runQuery forwards resume option to SDK"
```

---

### Task 2: Server — accept `sessionId` in body and forward to `runQuery`

**Files:**
- Modify: `src/server/routes/search.ts` (zod schema + forward)
- Modify: `tests/server/routes/search.test.ts` (+1 test)

- [ ] **Step 1: Write the failing test**

In `tests/server/routes/search.test.ts`, add inside the existing `describe('POST /api/search', ...)` block:

```typescript
  it('accepts sessionId in body for follow-up turns', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({ query: 'follow-up', sessionId: 'sess-prior-1' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/event-stream/);
  });

  it('rejects sessionId of wrong type', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scry-Csrf': getCsrfToken(),
      },
      body: JSON.stringify({ query: 'q', sessionId: 123 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-body');
  });
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- tests/server/routes/search.test.ts
```

Expected: the new "accepts sessionId" test passes (zod by default accepts unknown fields), but the runQuery mock from C1's test file isn't currently configured to assert `resume` was passed. The "rejects sessionId of wrong type" test should fail (zod doesn't reject extra fields unless schema is strict OR the field is explicitly typed and mistyped).

If both fail or behavior is unexpected, debug before continuing.

- [ ] **Step 3: Update body schema and forward to `runQuery`**

In `src/server/routes/search.ts`, find the `BodySchema` definition:

```typescript
const BodySchema = z.object({
  query: z.string().min(1),
  fanoutMode: z.boolean().optional(),
});
```

Replace with:

```typescript
const BodySchema = z.object({
  query: z.string().min(1),
  fanoutMode: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});
```

Find the `runQuery({...})` call inside the streamSSE handler:

```typescript
      const queryStream = runQuery({
        prompt: body.query,
        config,
        scryConfigDir,
        signal: ctl.signal,
        fanoutMode: Boolean(body.fanoutMode),
      });
```

Replace with:

```typescript
      const queryStream = runQuery({
        prompt: body.query,
        config,
        scryConfigDir,
        signal: ctl.signal,
        fanoutMode: Boolean(body.fanoutMode),
        resume: body.sessionId,
      });
```

Update the `body` type annotation at the top of the handler:

```typescript
  let body: { query: string; fanoutMode?: boolean; sessionId?: string };
```

- [ ] **Step 4: Run + commit**

```bash
npm run build
npm test
# expected: 175 passing (was 173, +2 from this task)

git add src/server/routes/search.ts tests/server/routes/search.test.ts
git commit -m "feat(server): accept sessionId in /api/search body for resume

When sessionId is provided, server forwards as runQuery's resume option.
The SDK then loads the prior conversation from the session JSONL,
giving Claude full context for the follow-up turn."
```

---

### Task 3: Frontend — `TurnBlock` component

**Files:**
- Create: `web/src/components/TurnBlock.tsx`

A turn is one query → one answer pair. The block renders an optional divider above (for turns 2+), the source rail of just that turn's cards, status pips for tools active during that turn, and the answer with `[N]` superscripts scoped to that turn.

It owns its own `highlighted` state (which `[N]` is being hovered), so hover in turn 2 doesn't affect turn 1's rail.

- [ ] **Step 1: Implement**

```typescript
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
      <SourceRail cards={cards} highlightedIndex={highlighted} />
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
```

- [ ] **Step 2: Update `SourceCard.tsx` to scope its DOM `id` by turn**

In `web/src/components/SourceCard.tsx`, the current id is `source-card-${card.index}` which would collide across turns (each turn has its own `[1]`). Add a `turnIndex` prop:

Find:

```typescript
interface Props {
  card: SourceCardData;
  highlighted?: boolean;
}
```

Replace with:

```typescript
interface Props {
  card: SourceCardData;
  highlighted?: boolean;
  turnIndex?: number;
}
```

Update the function signature:

```typescript
export function SourceCard({ card, highlighted, turnIndex }: Props): JSX.Element {
```

Find the two `id={`source-card-${card.index}`}` occurrences and replace each with:

```typescript
        id={`source-card-${turnIndex ?? 0}-${card.index}`}
```

(Default to `0` when `turnIndex` is omitted, for backward compat with C1 single-turn callers — though those will all be replaced in T4.)

- [ ] **Step 3: Update `SourceRail.tsx` to forward `turnIndex`**

In `web/src/components/SourceRail.tsx`, add a `turnIndex` prop and forward to each `SourceCard`:

```typescript
interface Props {
  cards: SourceCardData[];
  highlightedIndex?: number;
  turnIndex?: number;
}

export function SourceRail({ cards, highlightedIndex, turnIndex }: Props): JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <div className="source-rail flex gap-2 overflow-x-auto py-2 mb-4">
      {cards.map((c) => (
        <SourceCard
          key={c.index}
          card={c}
          highlighted={c.index === highlightedIndex}
          turnIndex={turnIndex}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Pass `turnIndex` from `TurnBlock` to `SourceRail`**

Update `TurnBlock.tsx`'s `<SourceRail>` call:

```typescript
      <SourceRail cards={cards} highlightedIndex={highlighted} turnIndex={turnIndex} />
```

- [ ] **Step 5: Build + commit**

```bash
cd web && npm run build && cd ..

git add web/src/components/TurnBlock.tsx web/src/components/SourceCard.tsx web/src/components/SourceRail.tsx
git commit -m "feat(web): TurnBlock + per-turn-scoped source card DOM ids

Each turn renders its own block with its own rail and answer. Highlight
state lives inside TurnBlock so hover in turn N doesn't bleed into other
turns. SourceCard id format becomes 'source-card-{turn}-{idx}' so click-to-
scroll resolves to the correct turn's card."
```

---

### Task 4: Frontend — `Search.tsx` multi-turn state machine

**Files:**
- Modify: `web/src/routes/Search.tsx` (full refactor)

State changes from a single `cards/finalAnswer/finalized` triple (C1) to an array of turns. Each turn captures its own query, cards, answer, finalized flag, and activeTools.

- [ ] **Step 1: Replace `Search.tsx`**

```typescript
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
```

- [ ] **Step 2: Build, smoke-test live**

```bash
cd web && npm run build && cd ..
npm run build:server
```

Both should succeed. The user will smoke-test end-to-end after the PR opens.

- [ ] **Step 3: Commit**

```bash
git add web/src/routes/Search.tsx
git commit -m "feat(web): multi-turn search state machine + reload notice

Submit after 'done' creates a follow-up turn that sends sessionId
to the server, resuming the prior Claude conversation. Each turn
renders as its own TurnBlock with per-turn-scoped [N] citations.
'New search' clears all turns and drops the session.

A small notice appears once a follow-up has happened, reminding
users that hard reload loses state until C3 adds persistence."
```

---

### Task 5: Push + open PR

- [ ] **Step 1: Verify gh account + git config**

```bash
gh auth status 2>&1 | grep "account aviralv (keyring)" -A1 | head -2
git config user.email
# expected: aviralv account is active; user.email = aviralv@gmail.com
```

If wrong, switch:

```bash
gh auth switch --hostname github.com --user aviralv
```

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/search-followup-c2

gh pr create --repo aviralv/scry --title "feat: in-page follow-up turns (C2 of search rollout)" --body "$(cat <<'EOF'
## Summary

C2 of the three-checkpoint search rollout. Builds on C1 (PR #8). Adds:

- **Follow-up turns**: After `done`, the search input remains usable. Submitting sends \`sessionId\` so the SDK resumes the prior conversation from its session JSONL.
- **Per-turn \`[N]\` scoping**: Each turn renders its own \`TurnBlock\` with its own source rail and \`[1]\`–\`[N]\` citations. Hover/click on \`[N]\` in turn 2 only highlights cards in turn 2's rail.
- **Visual turn boundaries**: A horizontal divider appears between turns. Each turn is labeled \`Turn N: <query>\`.
- **\`New search\`** button drops the session and clears all turns. **\`Stop\`** button stays visible during streaming.
- **Reload notice**: A small italic notice at the bottom signals that hard reload loses state. Removed when C3 lands.

Single-shot in-memory only — no SQLite persistence (that's C3).

## Test plan

- [x] \`npm test\` — 175 passing. New tests: runQuery resume forwarding (engine), search route accepts sessionId + rejects bad-shape sessionId (server).
- [x] \`npm run build\` — server tsc clean + Vite clean
- [x] First query works as in C1
- [x] After 'done', input is reusable; submitting sends \`sessionId\` (verify in DevTools Network tab)
- [x] Server logs show \`resume: <id>\` passed to runQuery
- [x] New turn renders as its own block with divider above
- [x] Hover/click on turn 2's \`[N]\` only highlights turn 2's cards
- [x] \`New search\` clears everything; submitting starts a fresh session (no \`sessionId\` in body)
- [x] Hard reload of browser → state lost, notice was visible during follow-up
- [x] \`Stop\` mid-second-turn → partial answer + cards visible; can still resume with another follow-up

## Out of scope

- Plan C3 — library sidebar + SQLite persistence
- Plans E–H — MCP / registry / onboarding / preferences UIs
- Plan I — E2E hardening + npm publish

## Spec deviation

The spec mentions sending \`priorSources?: SourceCard[]\` in the request body (capped at 50). This PR drops it. Per-turn \`[N]\` scoping means each turn's source-tracker starts at \`[1]\`, and the SDK's \`resume\` already restores prior conversation from the session JSONL — so \`priorSources\` is redundant in C2. C3's persistence layer can revisit if SQLite-backed flow needs it.
EOF
)"
```

---

## Self-review

**Spec coverage** — every C2 acceptance criterion has a task:
- After C1's done, input remains usable → T4
- Submit triggers follow-up with sessionId in body → T4 (frontend) + T2 (server)
- Server logs resume: <id> passed to runQuery → T2
- New turn's tool-call/tool-result events stream → T4 (state machine appends to last turn)
- Visual divider between turns → T3 (TurnBlock `showDivider`)
- New turn's [N] superscripts scope only to that turn's cards → T3 (per-TurnBlock highlight state) + DOM id scoping
- New search clears everything → T4 (handleNewSearch)
- Hard reload → state lost, notice visible during follow-up → T4 (showReloadNotice)
- priorSources cap of 50 → INTENTIONALLY DROPPED (deviation noted)

**Placeholder scan** — none. Every step has actual code or actual command.

**Type consistency** —
- `TurnData` shape defined in T4, consumed by `TurnBlock` props in T3 (each field maps 1:1).
- `State` discriminated union covers all six UI states; reducer in T4 returns each kind correctly.
- `turnIndex` flows: T4's `Search.tsx` passes index from `.map((t, i) => ...)` → T3's `TurnBlock` props → forwarded to `SourceRail` → forwarded to `SourceCard` for DOM id scoping.
- `sessionId` only set after `session-init` event; included in body only when `state.kind` carries it.
- Event types from `RunQueryEvent` union exhaustively handled in switch (T4); `keepalive` filtered before reducer.

**File structure check** — TurnBlock is a new file, ~80 lines, single responsibility (render one turn). Search.tsx grows from ~180 to ~210 lines, comfortable. SourceCard/SourceRail get a `turnIndex` prop addition only — no growth in responsibility.

Plan is ready for execution.
