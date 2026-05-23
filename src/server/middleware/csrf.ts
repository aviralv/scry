import type { MiddlewareHandler } from 'hono';
import { getCsrfToken } from './csrf-token.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfRequired(): MiddlewareHandler {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      await next();
      return;
    }
    const provided = c.req.header('X-Scry-Csrf');
    if (!provided || provided !== getCsrfToken()) {
      return c.json({ error: 'csrf-required', message: 'Missing or invalid X-Scry-Csrf header' }, 403);
    }
    await next();
  };
}
