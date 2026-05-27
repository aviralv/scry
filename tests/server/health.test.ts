import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from '../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../src/server/middleware/csrf-token.js';
import { SessionsStore } from '../../src/storage/sessions.js';

let dir: string;
let store: SessionsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-health-test-'));
  store = new SessionsStore(join(dir, 'scry.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('server scaffold', () => {
  beforeAll(() => {
    generateCsrfToken();
  });

  it('GET /api/health returns 200 with status ok', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/csrf returns the boot token', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/csrf');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(getCsrfToken());
  });

  it('rejects bad-origin requests on health route too', async () => {
    const app = createServer({ port: 6678, sessionsStore: store });
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});
