import { useState, useEffect, useCallback, type JSX } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getOnboardingState, type OnboardingState } from '../lib/onboarding.js';
import { OnboardingRail, type RailStep, type StepStatus } from '../components/onboarding/OnboardingRail.js';
import { OnboardingLlm } from '../components/onboarding/OnboardingLlm.js';
import { OnboardingMcps } from '../components/onboarding/OnboardingMcps.js';
import { OnboardingConfirm } from '../components/onboarding/OnboardingConfirm.js';

type Step = 1 | 2 | 3;

function deriveStep(state: OnboardingState): Step {
  if (state.onboarding.completed) return 3;
  if (state.llm == null && !state.onboarding.llm_skipped) return 1;
  if (state.mcps.length === 0 && !state.onboarding.mcps_skipped) return 2;
  return 3;
}

function llmSummary(state: OnboardingState): string {
  if (state.onboarding.llm_skipped && !state.llm) return 'skipped';
  if (!state.llm) return '';
  return `${state.llm.model} · ${state.llm.base_url}`;
}

function mcpsSummary(state: OnboardingState): string {
  if (state.onboarding.mcps_skipped && state.mcps.length === 0) return 'skipped';
  if (state.mcps.length === 0) return '';
  return `${state.mcps.length} configured`;
}

function statusFor(step: Step, current: Step): StepStatus {
  if (step === current) return 'active';
  if (step < current) return 'done';
  return 'todo';
}

export function Onboarding(): JSX.Element {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const r = await getOnboardingState();
      setState(r);
    } catch {
      // 412 means no config — treat as fresh state.
      setState({ llm: null, mcps: [], onboarding: { completed: false }, detectedRefs: [], detectedEnvKeys: [] });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!state) return <div className="p-6 text-text-tertiary">Loading…</div>;

  const stepParam = searchParams.get('step');
  const urlStep = stepParam === '1' ? 1 : stepParam === '2' ? 2 : stepParam === '3' ? 3 : null;
  const currentStep: Step = urlStep ?? deriveStep(state);

  const goToStep = (n: Step) => {
    setSearchParams({ step: String(n) });
  };

  const advanceFromStep = async (n: Step) => {
    await refresh();
    if (n === 3) {
      // Coming out of finalize — go to home.
      navigate('/');
    } else {
      goToStep((n + 1) as Step);
    }
  };

  const railSteps: RailStep[] = [
    { n: 1, title: 'LLM', summary: llmSummary(state), status: statusFor(1, currentStep) },
    { n: 2, title: 'MCPs', summary: mcpsSummary(state), status: statusFor(2, currentStep) },
    { n: 3, title: 'Confirm & finish', summary: '', status: statusFor(3, currentStep) },
  ];

  return (
    <div className="flex h-full">
      <OnboardingRail steps={railSteps} onStepClick={goToStep} />
      <div className="flex-1 p-8 overflow-y-auto">
        {currentStep === 1 && (
          <OnboardingLlm
            initialLlm={state.llm}
            detectedRefs={state.detectedRefs}
            onAdvance={() => advanceFromStep(1)}
          />
        )}
        {currentStep === 2 && (
          <OnboardingMcps
            initialMcps={state.mcps}
            detectedEnvKeys={state.detectedEnvKeys}
            onAdvance={() => advanceFromStep(2)}
          />
        )}
        {currentStep === 3 && (
          <OnboardingConfirm
            llm={state.llm}
            mcps={state.mcps}
            flags={state.onboarding}
            onFinalize={() => advanceFromStep(3)}
            onEditStep={(n) => goToStep(n)}
          />
        )}
      </div>
    </div>
  );
}
