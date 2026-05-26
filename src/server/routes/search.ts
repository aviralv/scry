import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { resolveConfigPath, loadConfig } from '../../config/loader.js';
import { runQuery } from '../../engine/runQuery.js';
import type { RunQueryEvent } from '../../engine/types.js';
import type { SessionsStore } from '../../storage/sessions.js';
import type { StoredTurn } from '../../storage/types.js';

const BodySchema = z.object({
  query: z.string().min(1),
  fanoutMode: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});

export function buildSearchRoute(store: SessionsStore): Hono {
  return new Hono().post('/', async (c) => {
    let body: { query: string; fanoutMode?: boolean; sessionId?: string };
    try {
      const raw = await c.req.json();
      body = BodySchema.parse(raw);
    } catch (err) {
      return c.json(
        { error: 'invalid-body', message: (err as Error).message ?? 'malformed JSON' },
        400,
      );
    }

    const configPath = resolveConfigPath();
    const configMissing = !existsSync(configPath);

    // Set proxy-friendly header before streamSSE starts the response.
    // streamSSE itself sets Content-Type, Cache-Control, and Connection.
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      if (configMissing) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'error',
            message: `Config not found at ${configPath}. Run scry init or copy a config there.`,
          } as RunQueryEvent),
        });
        return;
      }

      const config = loadConfig(configPath);
      const scryConfigDir = dirname(resolve(configPath));

      const ctl = new AbortController();
      c.req.raw.signal.addEventListener('abort', () => ctl.abort(), { once: true });

      let lastEventAt = Date.now();
      const keepAlive = setInterval(() => {
        if (Date.now() - lastEventAt >= 15_000) {
          stream.writeSSE({ data: JSON.stringify({ type: 'keepalive' }) }).catch(() => {});
        }
      }, 5_000);

      // Accumulate this turn's data so we can persist on `done`.
      // NOTE: cards accumulate from tool-result events (arrival order). On
      // sources-finalized, we replace with the canonical parsed list. The
      // `finalAnswer` is captured from the `done` event itself — NOT from
      // intermediate `assistant-text` events — to avoid divergence with the
      // engine's own `\n`-joined accumulation in runQuery.ts.
      const turn: StoredTurn = { query: body.query, finalAnswer: '', cards: [] };
      let sessionId: string | undefined = undefined;

      try {
        const queryStream = runQuery({
          prompt: body.query,
          config,
          scryConfigDir,
          signal: ctl.signal,
          fanoutMode: Boolean(body.fanoutMode),
          resume: body.sessionId,
        });

        for await (const event of queryStream) {
          lastEventAt = Date.now();
          if (event.type === 'session-init') {
            sessionId = event.sessionId;
          } else if (event.type === 'tool-result') {
            // Pre-finalize cards (arrival order); replaced if sources-finalized arrives.
            turn.cards.push(event.source);
          } else if (event.type === 'sources-finalized') {
            turn.cards = event.sources;
          } else if (event.type === 'done') {
            // Capture the engine's authoritative finalAnswer (matches what the
            // CLI/GUI rendered) — do NOT use a server-side concatenation of
            // assistant-text deltas, which would join differently than the
            // engine's own internal `\n`-join.
            turn.finalAnswer = event.finalAnswer;
            // If the engine never emitted sources-finalized (parser returned
            // empty), fall back to the done event's sources (= tracker.sources).
            if (turn.cards.length === 0 && event.sources.length > 0) {
              turn.cards = event.sources;
            }
            // Persist before forwarding the done event so client + db are coherent.
            persistTurn(store, sessionId ?? event.sessionId, scryConfigDir, body.sessionId, turn);
            sessionId = event.sessionId;
          }
          await stream.writeSSE({ data: JSON.stringify(event) });
          if (ctl.signal.aborted) break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message } as RunQueryEvent),
        });
      } finally {
        clearInterval(keepAlive);
      }
    });
  });
}

function persistTurn(
  store: SessionsStore,
  finalSessionId: string,
  cwd: string,
  priorSessionId: string | undefined,
  turn: StoredTurn,
): void {
  const now = Date.now();
  if (priorSessionId) {
    // Follow-up: append turn to the existing row.
    const existing = store.get(priorSessionId);
    if (existing) {
      store.update(priorSessionId, {
        turns: [...existing.turns, turn],
        updatedAt: now,
      });
      return;
    }
    // Row was deleted mid-conversation — fall through to insert (orphan recovery).
  }
  // First turn: insert new row. Title is a truncation of the query.
  store.insert({
    id: finalSessionId,
    cwd,
    title: truncateTitle(turn.query, 60),
    turns: [turn],
    createdAt: now,
    updatedAt: now,
  });
}

function truncateTitle(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
