import type { JSX } from 'react';

export type StepStatus = 'done' | 'active' | 'todo';

export interface RailStep {
  n: 1 | 2 | 3;
  title: string;
  summary: string;
  status: StepStatus;
}

interface Props {
  steps: RailStep[];
  onStepClick: (n: 1 | 2 | 3) => void;
}

export function OnboardingRail({ steps, onStepClick }: Props): JSX.Element {
  return (
    <nav className="w-60 shrink-0 border-r border-border bg-bg-secondary p-5" aria-label="Onboarding steps">
      <ol className="flex flex-col gap-0">
        {steps.map((s, i) => (
          <li key={s.n} className={i > 0 ? 'border-t border-border/50 pt-3 mt-3' : ''}>
            <button
              type="button"
              onClick={() => onStepClick(s.n)}
              aria-current={s.status === 'active' ? 'step' : undefined}
              className="w-full flex gap-3 items-start text-left"
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  s.status === 'done' ? 'bg-success text-bg-primary' :
                  s.status === 'active' ? 'bg-accent text-bg-primary' :
                  'bg-bg-elevated text-text-tertiary'
                }`}
                aria-hidden="true"
              >
                {s.status === 'done' ? '✓' : s.n}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${s.status === 'active' ? 'text-accent' : 'text-text-primary'}`}>
                  {s.title}
                </span>
                {s.summary && <span className="block text-xs text-text-tertiary mt-0.5">{s.summary}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
