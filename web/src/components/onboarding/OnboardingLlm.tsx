import { useState, useEffect, type JSX, type FormEvent } from 'react';
import type { OnboardingLlm as OnboardingLlmState } from '../../lib/onboarding.js';
import { putLlm, testLlm } from '../../lib/llm.js';
import { skipStep } from '../../lib/onboarding.js';

interface Props {
  initialLlm: OnboardingLlmState | null;
  detectedRefs: string[];
  onAdvance: () => void;
}

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;
const ENV_REF_RE = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export function OnboardingLlm({ initialLlm, detectedRefs, onAdvance }: Props): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(initialLlm?.base_url ?? 'https://api.anthropic.com');
  const detectedAnthropic = detectedRefs.includes('ANTHROPIC_API_KEY');
  const [authToken, setAuthToken] = useState(detectedAnthropic ? '${ANTHROPIC_API_KEY}' : '');
  const [model, setModel] = useState(initialLlm?.model ?? 'claude-haiku-4-5-20251001');
  const [noAuth, setNoAuth] = useState(LOCALHOST_RE.test(initialLlm?.base_url ?? 'https://api.anthropic.com'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When base_url changes, recompute the noAuth default.
  useEffect(() => {
    if (LOCALHOST_RE.test(baseUrl)) {
      setNoAuth(true);
    } else {
      setNoAuth(false);
    }
  }, [baseUrl]);

  const isLocal = LOCALHOST_RE.test(baseUrl);

  const handleContinue = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        base_url: baseUrl,
        model,
        ...(noAuth || !authToken ? {} : { auth_token: authToken }),
      };
      const test = await testLlm(payload);
      if (!test.ok) {
        setError(test.error ?? 'LLM test failed');
        setSubmitting(false);
        return;
      }
      await putLlm(payload);
      onAdvance();
    } catch (err) {
      setError((err as Error).message ?? 'failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (!window.confirm('Skip LLM setup? Searches will fail until you fix this.')) return;
    setSubmitting(true);
    try {
      await skipStep('llm');
      onAdvance();
    } catch (err) {
      setError((err as Error).message ?? 'skip failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleContinue} className="flex flex-col gap-4 max-w-xl">
      <h2 className="text-text-primary text-xl">Step 1 — Connect to your LLM</h2>

      <label className="flex flex-col gap-1 text-sm">
        Base URL
        <input
          aria-label="base url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          disabled={submitting}
          required
          className="bg-bg-elevated px-3 py-2 rounded font-mono text-sm"
        />
      </label>

      {isLocal && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="no auth required"
            checked={noAuth}
            onChange={(e) => setNoAuth(e.target.checked)}
            disabled={submitting}
          />
          No auth required (proxy handles it)
        </label>
      )}

      {!noAuth && (
        <label className="flex flex-col gap-1 text-sm">
          Auth token
          <input
            aria-label="auth token"
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            disabled={submitting}
            placeholder="${ANTHROPIC_API_KEY} or paste a literal value"
            className="bg-bg-elevated px-3 py-2 rounded font-mono text-sm"
          />
          {detectedAnthropic && ENV_REF_RE.test(authToken) && (
            <span className="text-text-tertiary text-xs">Detected from environment — leave as-is to use it, or paste a different value.</span>
          )}
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Model
        <input
          aria-label="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={submitting}
          required
          className="bg-bg-elevated px-3 py-2 rounded font-mono text-sm"
        />
      </label>

      {error && <div role="alert" className="text-error text-sm">{error}</div>}

      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-text-tertiary text-xs underline"
        >
          Skip — searches will fail until fixed
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-accent text-bg-primary rounded text-sm"
        >
          {submitting ? 'Testing…' : 'Test & Continue →'}
        </button>
      </div>
    </form>
  );
}
