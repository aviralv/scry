// src/server/routes/sessions.ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { SessionsStore } from '../../storage/sessions.js';

const PatchSchema = z.object({
  title: z.string().min(1).optional(),
});

export function buildSessionsRoute(store: SessionsStore): Hono {
  return new Hono()
    .get('/', (c) => {
      const limit = clampInt(c.req.query('limit'), 100, 1, 500);
      const before = parseIntOrUndefined(c.req.query('before'));
      const beforeId = c.req.query('beforeId');
      const rows = store.list({ limit, before, beforeId });
      return c.json({ sessions: rows });
    })
    .get('/:id', (c) => {
      const row = store.get(c.req.param('id'));
      if (!row) return c.json({ error: 'not-found' }, 404);
      return c.json(row);
    })
    .patch('/:id', async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid-body' }, 400);
      }
      const parsed = PatchSchema.safeParse(raw);
      if (!parsed.success) return c.json({ error: 'invalid-body', details: parsed.error.format() }, 400);
      const id = c.req.param('id');
      // Single-write existence check: skip the pre-flight get() and rely on
      // UPDATE's own rows-affected count. Avoids TOCTOU between get and update.
      const changed = store.update(id, { ...parsed.data, updatedAt: Date.now() });
      if (changed === 0) return c.json({ error: 'not-found' }, 404);
      return c.json({ ok: true });
    })
    .delete('/:id', (c) => {
      const id = c.req.param('id');
      const changed = store.delete(id);
      if (changed === 0) return c.json({ error: 'not-found' }, 404);
      return c.json({ ok: true });
    });
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (!raw) return def;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function parseIntOrUndefined(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}
