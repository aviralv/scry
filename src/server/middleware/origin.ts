import type { MiddlewareHandler } from 'hono';

export function originAllowlist(port: number): MiddlewareHandler {
  const allowed = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
  ]);
  return async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !allowed.has(origin)) {
      return c.json({ error: 'origin-rejected', message: `Origin ${origin} not allowed` }, 403);
    }
    await next();
  };
}
