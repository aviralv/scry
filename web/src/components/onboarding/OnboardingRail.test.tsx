import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingRail, type StepStatus } from './OnboardingRail.js';

const baseSteps: Array<{ n: 1 | 2 | 3; title: string; summary: string; status: StepStatus }> = [
  { n: 1, title: 'LLM', summary: 'claude-haiku-4-5', status: 'done' },
  { n: 2, title: 'MCPs', summary: '2 picked', status: 'active' },
  { n: 3, title: 'Confirm & finish', summary: '', status: 'todo' },
];

describe('OnboardingRail', () => {
  it('renders all three steps with their titles', () => {
    render(<OnboardingRail steps={baseSteps} onStepClick={() => {}} />);
    expect(screen.getByText('LLM')).toBeTruthy();
    expect(screen.getByText('MCPs')).toBeTruthy();
    expect(screen.getByText('Confirm & finish')).toBeTruthy();
  });

  it('renders summaries for done and active steps', () => {
    render(<OnboardingRail steps={baseSteps} onStepClick={() => {}} />);
    expect(screen.getByText('claude-haiku-4-5')).toBeTruthy();
    expect(screen.getByText('2 picked')).toBeTruthy();
  });

  it('marks the active step with aria-current=step', () => {
    render(<OnboardingRail steps={baseSteps} onStepClick={() => {}} />);
    const active = screen.getByRole('button', { current: 'step' });
    expect(active.textContent).toContain('MCPs');
  });

  it('calls onStepClick with the clicked step number', () => {
    const onStepClick = vi.fn();
    render(<OnboardingRail steps={baseSteps} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByText('LLM').closest('button')!);
    expect(onStepClick).toHaveBeenCalledWith(1);
  });
});
