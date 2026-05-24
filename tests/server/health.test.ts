import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../src/server/middleware/csrf-token.js';

describe('server scaffold', () => {
  beforeAll(() => {
    generateCsrfToken();
  });

  it('GET /api/health returns 200 with status ok', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/csrf returns the boot token', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/csrf');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(getCsrfToken());
  });

  it('rejects bad-origin requests on health route too', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});
