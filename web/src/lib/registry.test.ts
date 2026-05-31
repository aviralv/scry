import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as registry from './registry.js';
import { ApiCallError } from './api.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  document.head.innerHTML = '<meta name="scry-csrf" content="test-token">';
});

describe('getRegistry', () => {
  it('returns the registry object', async () => {
    const reg = { people: {}, projects: {} };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ registry: reg }), { status: 200 }));
    const r = await registry.getRegistry();
    expect(r).toEqual(reg);
  });

  it('throws ApiCallError with status 412 on missing config', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'config-required' }), { status: 412 }));
    let caught: unknown;
    try { await registry.getRegistry(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiCallError);
    expect((caught as ApiCallError).status).toBe(412);
  });
});

describe('putRegistry', () => {
  it('PUTs the registry and returns the saved value', async () => {
    const reg = { people: { x: { name: 'X', identifiers: {} } }, projects: {} };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ registry: reg }), { status: 200 }));
    const r = await registry.putRegistry(reg);
    expect(r.people.x.name).toBe('X');
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('PUT');
    expect(call[1].headers.get('X-Scry-Csrf')).toBe('test-token');
  });

  it('throws ApiCallError with body.errors populated on 400', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: 'invalid-body', errors: [{ path: ['people', 'BAD KEY'], message: 'Invalid' }] }),
      { status: 400 },
    ));
    let caught: unknown;
    try { await registry.putRegistry({ people: {}, projects: {} }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiCallError);
    expect((caught as ApiCallError).body.errors).toEqual([{ path: ['people', 'BAD KEY'], message: 'Invalid' }]);
  });
});
