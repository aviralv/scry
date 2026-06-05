import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireOnboarding } from './RequireOnboarding.js';
import * as onboarding from '../lib/onboarding.js';

vi.mock('../lib/onboarding.js');

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<RequireOnboarding><div>HOME</div></RequireOnboarding>} />
        <Route path="/onboarding" element={<div>WIZARD</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequireOnboarding', () => {
  it('renders children when onboarding is completed', async () => {
    vi.mocked(onboarding.getOnboardingState).mockResolvedValue({
      llm: { base_url: 'https://api.anthropic.com', model: 'm', hasAuth: true },
      mcps: [],
      onboarding: { completed: true },
      detectedRefs: [],
      detectedEnvKeys: [],
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByText('HOME')).toBeTruthy());
  });

  it('redirects to /onboarding when completed:false', async () => {
    vi.mocked(onboarding.getOnboardingState).mockResolvedValue({
      llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [],
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByText('WIZARD')).toBeTruthy());
  });

  it('redirects on 412 from the API', async () => {
    const { ApiCallError } = await import('../lib/api.js');
    vi.mocked(onboarding.getOnboardingState).mockRejectedValue(new ApiCallError(412, { error: 'config-required' }));
    renderAt('/');
    await waitFor(() => expect(screen.getByText('WIZARD')).toBeTruthy());
  });

  it('re-fetches on document visibility change', async () => {
    // First load: onboarded — show HOME.
    vi.mocked(onboarding.getOnboardingState).mockResolvedValueOnce({
      llm: { base_url: 'x', model: 'y', hasAuth: true },
      mcps: [], onboarding: { completed: true }, detectedRefs: [], detectedEnvKeys: [],
    });
    renderAt('/');
    await waitFor(() => expect(screen.getByText('HOME')).toBeTruthy());
    expect(vi.mocked(onboarding.getOnboardingState)).toHaveBeenCalledTimes(1);

    // Simulate the wizard being un-completed in another tab (e.g. config wiped).
    vi.mocked(onboarding.getOnboardingState).mockResolvedValueOnce({
      llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [],
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(vi.mocked(onboarding.getOnboardingState)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('WIZARD')).toBeTruthy());
  });
});
