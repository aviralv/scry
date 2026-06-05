import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Onboarding } from './Onboarding.js';
import * as onboardingLib from '../lib/onboarding.js';
import * as discoverLib from '../lib/mcps-discover.js';

vi.mock('../lib/onboarding.js');
vi.mock('../lib/mcps-discover.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(discoverLib.discoverMcps).mockResolvedValue({ bundled: [], pathInstalled: [] });
});
afterEach(() => vi.restoreAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const fresh = { llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [] };

describe('Onboarding route — step derivation', () => {
  it('lands on Step 1 when llm is null', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue(fresh);
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });

  it('lands on Step 2 when llm is set but mcps are empty', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'https://api.anthropic.com', model: 'm', hasAuth: true },
    });
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeTruthy());
  });

  it('lands on Step 3 when llm + mcps are present', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'https://api.anthropic.com', model: 'm', hasAuth: true },
      mcps: [{ name: 'slack', command: 'slack-mcp', enabled: true }],
    });
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
  });

  it('lands on Step 3 when completed:true (re-entry)', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'x', model: 'y', hasAuth: true },
      mcps: [{ name: 'slack', command: 'slack-mcp', enabled: true }],
      onboarding: { completed: true },
    });
    renderAt('/onboarding');
    await waitFor(() => expect(screen.getByText(/Step 3/)).toBeTruthy());
  });

  it('honors URL ?step=1 override even when llm is set', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'x', model: 'y', hasAuth: true },
    });
    renderAt('/onboarding?step=1');
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });

  it('rail click navigates to the requested step (URL updates)', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'x', model: 'y', hasAuth: true },
      mcps: [{ name: 'slack', command: 'slack-mcp', enabled: true }],
    });
    renderAt('/onboarding');
    await waitFor(() => screen.getByText(/Step 3/));
    // Click the rail's "LLM" button (first of the two buttons with accessible name matching /LLM/i).
    const llmButtons = screen.getAllByRole('button', { name: /LLM/i });
    fireEvent.click(llmButtons[0]);
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });

  it('does NOT honor URL ?step=3 when llm is null (cannot skip ahead)', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue(fresh);
    renderAt('/onboarding?step=3');
    // Derived step is 1 (no llm); URL says 3 — should land on Step 1, not Step 3.
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });

  it('does honor URL ?step=1 when current is Step 3 (can go back)', async () => {
    vi.mocked(onboardingLib.getOnboardingState).mockResolvedValue({
      ...fresh,
      llm: { base_url: 'x', model: 'y', hasAuth: true },
      mcps: [{ name: 'slack', command: 'slack-mcp', enabled: true }],
      onboarding: { completed: true },
    });
    renderAt('/onboarding?step=1');
    // Derived step is 3 (completed); URL says 1 — going back is allowed.
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeTruthy());
  });
});
