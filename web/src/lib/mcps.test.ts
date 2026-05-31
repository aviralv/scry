import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as mcps from './mcps.js';
import { ApiCallError } from './api.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  // Stub the CSRF meta tag so api.ts's getCsrfToken() resolves synchronously.
  document.head.innerHTML = '<meta name="scry-csrf" content="test-token">';
});

describe('listMcps', () => {
  it('returns servers array', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ servers: [] }), { status: 200 }));
    const r = await mcps.listMcps();
    expect(r).toEqual([]);
  });
  it('throws ApiCallError with 412 status on missing config', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'config-required' }), { status: 412 }),
    );
    await expect(mcps.listMcps()).rejects.toBeInstanceOf(ApiCallError);
    try {
      await mcps.listMcps();
    } catch (err) {
      expect((err as ApiCallError).status).toBe(412);
    }
  });
});

describe('createMcp', () => {
  it('POSTs and returns server entry on 201', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ server: { name: 'x', command: 'x', enabled: true } }), { status: 201 }),
    );
    const r = await mcps.createMcp({ name: 'x', command: 'x' });
    expect(r.name).toBe('x');
    // Verify the request was POST with the X-Scry-Csrf header set
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].headers.get('X-Scry-Csrf')).toBe('test-token');
  });
});
