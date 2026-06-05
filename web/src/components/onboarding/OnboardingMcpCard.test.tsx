import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingMcpCard } from './OnboardingMcpCard.js';

const slack = {
  name: 'Slack',
  slug: 'slack',
  command: 'slack-mcp',
  githubUrl: 'https://github.com/aviralv/slack-mcp',
  description: 'Slack search, channel history, DMs',
  envVars: ['SLACK_TOKEN'],
};

describe('OnboardingMcpCard', () => {
  it('renders name + description + PATH ok status when on PATH', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={false}
        envValues={{}}
        detectedEnvKeys={new Set()}
        overrides={new Set()}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onOverride={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    expect(screen.getByText('Slack')).toBeTruthy();
    expect(screen.getByText(/slack-mcp on path/i)).toBeTruthy();
  });

  it('shows install hint when not on PATH', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={false}
        envValues={{}}
        detectedEnvKeys={new Set()}
        overrides={new Set()}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onOverride={() => {}}
        onPath={false}
        statusKind="idle"
      />
    );
    expect(screen.getByText(/uv tool install git\+https:\/\/github.com\/aviralv\/slack-mcp/i)).toBeTruthy();
  });

  it('renders an env input for each entry in envVars when picked', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={true}
        envValues={{}}
        detectedEnvKeys={new Set()}
        overrides={new Set()}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onOverride={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    expect(screen.getByLabelText('SLACK_TOKEN')).toBeTruthy();
  });

  it('calls onPickedChange when checkbox toggled', () => {
    const onPickedChange = vi.fn();
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={false}
        envValues={{}}
        detectedEnvKeys={new Set()}
        overrides={new Set()}
        onPickedChange={onPickedChange}
        onEnvChange={() => {}}
        onOverride={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onPickedChange).toHaveBeenCalledWith(true);
  });

  it('shows error message when statusKind is error', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={true}
        envValues={{ SLACK_TOKEN: 'bad' }}
        detectedEnvKeys={new Set()}
        overrides={new Set()}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onOverride={() => {}}
        onPath={true}
        statusKind="error"
        errorMessage="health-check failed"
      />
    );
    expect(screen.getByText('health-check failed')).toBeTruthy();
  });

  it('shows "(from .scry.env)" placeholder for env keys in detectedEnvKeys', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={true}
        envValues={{}}
        detectedEnvKeys={new Set(['SLACK_TOKEN'])}
        overrides={new Set()}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onOverride={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    const input = screen.getByLabelText('SLACK_TOKEN') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('(from .scry.env)');
    expect(screen.getByRole('button', { name: /override/i })).toBeTruthy();
  });

  it('Override button calls onOverride with the key', () => {
    const onOverride = vi.fn();
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={true}
        envValues={{}}
        detectedEnvKeys={new Set(['SLACK_TOKEN'])}
        overrides={new Set()}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onOverride={onOverride}
        onPath={true}
        statusKind="idle"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /override/i }));
    expect(onOverride).toHaveBeenCalledWith('SLACK_TOKEN');
  });

  it('shows password input when key is in overrides Set', () => {
    render(
      <OnboardingMcpCard
        bundled={slack}
        picked={true}
        envValues={{ SLACK_TOKEN: '' }}
        detectedEnvKeys={new Set(['SLACK_TOKEN'])}
        overrides={new Set(['SLACK_TOKEN'])}
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onOverride={() => {}}
        onPath={true}
        statusKind="idle"
      />
    );
    const input = screen.getByLabelText('SLACK_TOKEN') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.type).toBe('password');
  });
});
