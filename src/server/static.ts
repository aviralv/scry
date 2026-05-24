import type { MiddlewareHandler } from 'hono';
import { promises as fs } from 'fs';
import { join, normalize, sep } from 'path';
import { getCsrfToken } from './middleware/csrf-token.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const CSP =
  "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:";

export function staticHandler(rootDir: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();

    const urlPath = c.req.path === '/' ? '/index.html' : c.req.path;
    if (urlPath.startsWith('/api/')) return next();

    const hasExt = /\.[a-z0-9]+$/i.test(urlPath);
    const target = hasExt ? urlPath : '/index.html';
    const fsPath = normalize(join(rootDir, target));
    const rootPrefix = normalize(rootDir) + sep;

    if (!fsPath.startsWith(rootPrefix) && fsPath !== normalize(rootDir)) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const ext = target.slice(target.lastIndexOf('.'));
    const mime = MIME[ext] ?? 'application/octet-stream';

    let content: Buffer | string;
    try {
      content = await fs.readFile(fsPath);
    } catch {
      return c.json({ error: 'not-found' }, 404);
    }

    if (target.endsWith('.html')) {
      content = content.toString('utf-8').replace('__SCRY_CSRF__', getCsrfToken());
    }

    return new Response(typeof content === 'string' ? content : new Uint8Array(content), {
      headers: {
        'Content-Type': mime,
        'Content-Security-Policy': CSP,
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}
