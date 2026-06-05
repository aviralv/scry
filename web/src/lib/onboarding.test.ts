import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getOnboardingState, completeOnboarding, skipStep, addOnboardingMcp } from './onboarding.js';

const origFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Stub the CSRF endpoint that getCsrfToken hits.
  fetchMock.mockImplementation(async (url: string) => {
    if (url.toString().includes('/api/csrf')) {
      return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => { globalThis.fetch = origFetch; });

describe('onboarding client', () => {
  it('getOnboardingState GETs /api/onboarding', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [],
    }), { status: 200 }));
    const r = await getOnboardingState();
    expect(r.onboarding.completed).toBe(false);
  });

  it('completeOnboarding POSTs /api/onboarding/complete with CSRF', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.toString().includes('/api/csrf')) return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
      const headers = new Headers(init.headers);
      expect(headers.get('X-Scry-Csrf')).toBe('tok');
      return new Response(JSON.stringify({ completed: true }), { status: 200 });
    });
    await completeOnboarding();
  });

  it('skipStep posts the step name', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.toString().includes('/api/csrf')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      expect((init as RequestInit).body).toBe(JSON.stringify({ step: 'llm' }));
      return new Response(JSON.stringify({ onboarding: { completed: false, llm_skipped: true } }), { status: 200 });
    });
    await skipStep('llm');
  });

  it('addOnboardingMcp posts the wizard payload', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.toString().includes('/api/csrf')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toEqual({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } });
      return new Response(JSON.stringify({ server: { name: 'slack', command: 'slack-mcp', enabled: true } }), { status: 201 });
    });
    const r = await addOnboardingMcp({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } });
    expect(r.name).toBe('slack');
  });
});
