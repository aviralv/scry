import { useState, useEffect, type JSX } from 'react';
import { getLlm, type LlmState } from '../lib/llm.js';
import { LlmForm } from '../components/LlmForm.js';

export function SettingsLlm(): JSX.Element {
  const [llm, setLlm] = useState<LlmState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getLlm()
      .then((r) => setLlm(r.llm))
      .catch((err) => setError((err as Error).message ?? 'failed to load'));
  }, []);

  if (error) {
    return <div className="text-error text-sm">{error}</div>;
  }

  if (llm === undefined) {
    return <div className="text-text-tertiary text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-xl p-6">
      <h1 className="text-xl text-text-primary mb-1">LLM Provider</h1>
      <p className="text-text-tertiary text-sm mb-6">
        Configure the LLM used for search synthesis. Currently supports Anthropic Claude — more providers coming soon.
      </p>
      <LlmForm
        initialValues={llm ? {
          provider: llm.provider,
          base_url: llm.base_url,
          model: llm.model,
          auth_token: llm.auth_token,
          hasAuth: llm.hasAuth,
        } : undefined}
      />
    </div>
  );
}
