import { useState, type JSX } from 'react';
import type { McpServerEntry } from '../../lib/mcps.js';
import type { OnboardingLlm, OnboardingFlags } from '../../lib/onboarding.js';
import { completeOnboarding } from '../../lib/onboarding.js';

interface Props {
  llm: OnboardingLlm | null;
  mcps: McpServerEntry[];
  flags: OnboardingFlags;
  onFinalize: () => void;
  onEditStep: (n: 1 | 2) => void;
}

export function OnboardingConfirm({ llm, mcps, flags, onFinalize, onEditStep }: Props): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinalize = async () => {
    setSubmitting(true);
    try {
      await completeOnboarding();
      onFinalize();
    } catch (err) {
      setError((err as Error).message ?? 'finalize failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <h2 className="text-text-primary text-xl">Step 3 — Confirm &amp; finish</h2>

      <section className="border border-border rounded p-4">
        <div className="flex justify-between items-start">
          <h3 className="text-text-primary font-medium">LLM</h3>
          <button type="button" onClick={() => onEditStep(1)} className="text-xs underline text-text-tertiary" aria-label="Edit LLM">
            Edit
          </button>
        </div>
        {llm ? (
          <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-text-tertiary">Model</dt><dd className="font-mono text-xs">{llm.model}</dd>
            <dt className="text-text-tertiary">Base URL</dt><dd className="font-mono text-xs">{llm.base_url}</dd>
            <dt className="text-text-tertiary">Auth</dt>
            <dd className="text-xs">{llm.hasAuth ? <span className="text-success">✓ configured</span> : <span className="text-text-tertiary">not configured (proxy?)</span>}</dd>
          </dl>
        ) : (
          <div className="mt-3 text-sm text-text-tertiary italic">Not configured.</div>
        )}
        {flags.llm_skipped && (
          <div className="mt-3 text-xs text-warning">⚠ LLM not configured — searches will fail until you complete LLM setup.</div>
        )}
      </section>

      <section className="border border-border rounded p-4">
        <div className="flex justify-between items-start">
          <h3 className="text-text-primary font-medium">MCPs</h3>
          <button type="button" onClick={() => onEditStep(2)} className="text-xs underline text-text-tertiary" aria-label="Edit MCPs">
            Edit
          </button>
        </div>
        {mcps.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {mcps.map((m) => (
              <li key={m.name} className="flex items-center gap-2">
                <span className="text-success">✓</span>
                <span className="font-mono text-xs">{m.name}</span>
                <span className="text-text-tertiary text-xs">— {m.command}</span>
              </li>
            ))}
          </ul>
        ) : !flags.mcps_skipped ? (
          <div className="mt-3 text-sm text-text-tertiary italic">No MCPs configured.</div>
        ) : null}
        {flags.mcps_skipped && mcps.length === 0 && (
          <div className="mt-3 text-xs text-warning">⚠ No MCPs configured — search has no sources.</div>
        )}
      </section>

      {error && <div role="alert" className="text-error text-sm">{error}</div>}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleFinalize}
          disabled={submitting}
          className="px-4 py-2 bg-accent text-bg-primary rounded text-sm"
        >
          {submitting ? 'Finalizing…' : 'Finalize & start searching'}
        </button>
      </div>
    </div>
  );
}
