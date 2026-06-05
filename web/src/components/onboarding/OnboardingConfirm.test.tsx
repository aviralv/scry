import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingConfirm } from './OnboardingConfirm.js';
import * as onboardingLib from '../../lib/onboarding.js';

vi.mock('../../lib/onboarding.js');

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

const baseLlm = { base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', hasAuth: true };
const baseMcps = [{ name: 'slack', command: 'slack-mcp', enabled: true }];

describe('OnboardingConfirm', () => {
  it('renders LLM model and base_url', () => {
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={() => {}} onEditStep={() => {}} />);
    expect(screen.getByText(/claude-haiku-4-5-20251001/)).toBeTruthy();
    expect(screen.getByText(/api.anthropic.com/)).toBeTruthy();
  });

  it('renders each MCP with status', () => {
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={() => {}} onEditStep={() => {}} />);
    expect(screen.getByText('slack')).toBeTruthy();
  });

  it('shows skip warnings when flags are set', () => {
    render(<OnboardingConfirm llm={null} mcps={[]} flags={{ completed: false, llm_skipped: true, mcps_skipped: true }} onFinalize={() => {}} onEditStep={() => {}} />);
    expect(screen.getByText(/llm.*not configured/i)).toBeTruthy();
    expect(screen.getByText(/no mcps configured/i)).toBeTruthy();
  });

  it('Finalize calls completeOnboarding then onFinalize', async () => {
    vi.mocked(onboardingLib.completeOnboarding).mockResolvedValue();
    const onFinalize = vi.fn();
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={onFinalize} onEditStep={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /finalize/i }));
    await waitFor(() => expect(vi.mocked(onboardingLib.completeOnboarding)).toHaveBeenCalled());
    await waitFor(() => expect(onFinalize).toHaveBeenCalled());
  });

  it('Edit Step 1 calls onEditStep(1)', () => {
    const onEditStep = vi.fn();
    render(<OnboardingConfirm llm={baseLlm} mcps={baseMcps} flags={{ completed: false }} onFinalize={() => {}} onEditStep={onEditStep} />);
    fireEvent.click(screen.getByRole('button', { name: /edit llm/i }));
    expect(onEditStep).toHaveBeenCalledWith(1);
  });
});
