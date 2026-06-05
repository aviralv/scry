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
        onPickedChange={() => {}}
        onEnvChange={() => {}}
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
        onPickedChange={() => {}}
        onEnvChange={() => {}}
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
        onPickedChange={() => {}}
        onEnvChange={() => {}}
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
        onPickedChange={onPickedChange}
        onEnvChange={() => {}}
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
        onPickedChange={() => {}}
        onEnvChange={() => {}}
        onPath={true}
        statusKind="error"
        errorMessage="health-check failed"
      />
    );
    expect(screen.getByText('health-check failed')).toBeTruthy();
  });
});
