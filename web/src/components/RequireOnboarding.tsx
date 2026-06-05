import { useEffect, useState, useCallback, type JSX, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiCallError } from '../lib/api.js';
import { getOnboardingState } from '../lib/onboarding.js';

type State =
  | { kind: 'loading' }
  | { kind: 'redirect' }
  | { kind: 'pass' };

interface Props {
  children: ReactNode;
}

export function RequireOnboarding({ children }: Props): JSX.Element | null {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const fetchState = useCallback(async () => {
    try {
      const r = await getOnboardingState();
      setState(r.onboarding.completed ? { kind: 'pass' } : { kind: 'redirect' });
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 412) {
        setState({ kind: 'redirect' });
      } else {
        // On unexpected errors, fail open (render children) — better than
        // trapping the user in a redirect loop.
        setState({ kind: 'pass' });
      }
    }
  }, []);

  useEffect(() => {
    void fetchState();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchState();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchState]);

  if (state.kind === 'loading') return null;
  if (state.kind === 'redirect') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
