import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingLlm } from './OnboardingLlm.js';
import * as llmLib from '../../lib/llm.js';
import * as onboardingLib from '../../lib/onboarding.js';

vi.mock('../../lib/llm.js');
vi.mock('../../lib/onboarding.js');

const baseProps = {
  initialLlm: null,
  detectedRefs: [],
  onAdvance: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  baseProps.onAdvance = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('OnboardingLlm', () => {
  it('renders default base_url and model', () => {
    render(<OnboardingLlm {...baseProps} />);
    expect((screen.getByLabelText(/base url/i) as HTMLInputElement).value).toBe('https://api.anthropic.com');
    expect((screen.getByLabelText(/model/i) as HTMLInputElement).value).toBe('claude-haiku-4-5-20251001');
  });

  it('prefills auth field with ${ANTHROPIC_API_KEY} when detected', () => {
    render(<OnboardingLlm {...baseProps} detectedRefs={['ANTHROPIC_API_KEY']} />);
    expect((screen.getByLabelText(/auth/i) as HTMLInputElement).value).toBe('${ANTHROPIC_API_KEY}');
    expect(screen.getByText(/detected/i)).toBeTruthy();
  });

  it('shows the no-auth-required checkbox for localhost base_url, default-checked', () => {
    render(<OnboardingLlm {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/base url/i), { target: { value: 'http://localhost:6655/anthropic/' } });
    const cb = screen.getByLabelText(/no auth required/i) as HTMLInputElement;
    expect(cb).toBeTruthy();
    expect(cb.checked).toBe(true);
  });

  it('runs llm test then PUTs on Continue and calls onAdvance', async () => {
    vi.mocked(llmLib.testLlm).mockResolvedValue({ ok: true });
    vi.mocked(llmLib.putLlm).mockResolvedValue({ llm: { base_url: 'x', model: 'y' } });
    render(<OnboardingLlm {...baseProps} detectedRefs={['ANTHROPIC_API_KEY']} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(vi.mocked(llmLib.testLlm)).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(llmLib.putLlm)).toHaveBeenCalled());
    await waitFor(() => expect(baseProps.onAdvance).toHaveBeenCalled());
  });

  it('shows error and does NOT advance when test fails', async () => {
    vi.mocked(llmLib.testLlm).mockResolvedValue({ ok: false, error: '401 unauthorized' });
    render(<OnboardingLlm {...baseProps} detectedRefs={['ANTHROPIC_API_KEY']} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText(/401 unauthorized/i)).toBeTruthy());
    expect(vi.mocked(llmLib.putLlm)).not.toHaveBeenCalled();
    expect(baseProps.onAdvance).not.toHaveBeenCalled();
  });

  it('Skip calls skipStep("llm") and advances', async () => {
    vi.mocked(onboardingLib.skipStep).mockResolvedValue({ completed: false, llm_skipped: true });
    render(<OnboardingLlm {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await waitFor(() => expect(vi.mocked(onboardingLib.skipStep)).toHaveBeenCalledWith('llm'));
    await waitFor(() => expect(baseProps.onAdvance).toHaveBeenCalled());
  });
});
