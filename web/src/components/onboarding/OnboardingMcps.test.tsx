import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingMcps } from './OnboardingMcps.js';
import * as discoverLib from '../../lib/mcps-discover.js';
import * as onboardingLib from '../../lib/onboarding.js';

vi.mock('../../lib/mcps-discover.js');
vi.mock('../../lib/onboarding.js');

const bundled = [
  { name: 'Slack', slug: 'slack', command: 'slack-mcp', githubUrl: 'https://github.com/aviralv/slack-mcp', description: 'Slack search and DMs', envVars: ['SLACK_TOKEN'] },
  { name: 'MS365', slug: 'ms365', command: 'ms365-intent-mcp', githubUrl: 'https://x', description: 'Microsoft 365 integration', envVars: ['MS365_CLIENT_ID'] },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(discoverLib.discoverMcps).mockResolvedValue({
    bundled,
    pathInstalled: ['slack-mcp', 'ms365-intent-mcp'],
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('OnboardingMcps', () => {
  it('renders all bundled cards on mount', async () => {
    render(<OnboardingMcps initialMcps={[]} onAdvance={() => {}} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());
    expect(screen.getByText('MS365')).toBeTruthy();
  });

  it('does NOT call addOnboardingMcp when nothing is picked and Continue is clicked', async () => {
    render(<OnboardingMcps initialMcps={[]} onAdvance={() => {}} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getByRole('button', { name: /test.*continue/i }));
    expect(vi.mocked(onboardingLib.addOnboardingMcp)).not.toHaveBeenCalled();
  });

  it('runs addOnboardingMcp for each picked card and advances on success', async () => {
    vi.mocked(onboardingLib.addOnboardingMcp).mockImplementation(async (input) => ({
      name: input.name, command: input.command, enabled: true,
    }));
    const onAdvance = vi.fn();
    render(<OnboardingMcps initialMcps={[]} onAdvance={onAdvance} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);  // pick Slack
    fireEvent.change(screen.getByLabelText('SLACK_TOKEN'), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: /test.*continue/i }));
    await waitFor(() => expect(vi.mocked(onboardingLib.addOnboardingMcp)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'slack', command: 'slack-mcp', envValues: { SLACK_TOKEN: 'tok' } })
    ));
    await waitFor(() => expect(onAdvance).toHaveBeenCalled());
  });

  it('shows per-card error and allows Drop & continue when health-check fails', async () => {
    const { ApiCallError } = await import('../../lib/api.js');
    vi.mocked(onboardingLib.addOnboardingMcp).mockRejectedValueOnce(
      new ApiCallError(422, { error: 'health-check-failed', message: 'spawn failed' })
    );
    render(<OnboardingMcps initialMcps={[]} onAdvance={() => {}} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.change(screen.getByLabelText('SLACK_TOKEN'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /test.*continue/i }));
    await waitFor(() => expect(screen.getByText(/spawn failed/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /drop.*continue/i })).toBeTruthy();
  });

  it('Skip calls skipStep("mcps") and advances', async () => {
    vi.mocked(onboardingLib.skipStep).mockResolvedValue({ completed: false, mcps_skipped: true });
    const onAdvance = vi.fn();
    render(<OnboardingMcps initialMcps={[]} onAdvance={onAdvance} />);
    await waitFor(() => screen.getByText('Slack'));
    fireEvent.click(screen.getByRole('button', { name: /configure mcps later/i }));
    await waitFor(() => expect(vi.mocked(onboardingLib.skipStep)).toHaveBeenCalledWith('mcps'));
    await waitFor(() => expect(onAdvance).toHaveBeenCalled());
  });
});
