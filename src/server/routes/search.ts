import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { resolveConfigPath, loadConfig } from '../../config/loader.js';
import { runQuery } from '../../engine/runQuery.js';
import type { RunQueryEvent } from '../../engine/types.js';

const BodySchema = z.object({
  query: z.string().min(1),
  fanoutMode: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});

export const searchRoute = new Hono().post('/', async (c) => {
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
