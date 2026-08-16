import { useState, type JSX, type FormEvent } from 'react';
import type { LlmConfig, LlmProvider } from '@shared/types.js';
import { testLlm, putLlm } from '../lib/llm.js';

interface Props {
  initialValues?: {
    provider?: LlmProvider;
    base_url?: string;
    model?: string;
    auth_token?: string | null;
    hasAuth?: boolean;
  };
  detectedRefs?: string[];
  onSaved?: () => void;
  submitLabel?: string;
}

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;
const ENV_REF_RE = /^\$\{[A-Z][A-Z0-9_]*\}$/;

const PROVIDER_DEFAULTS: Record<LlmProvider, { base_url: string; model: string }> = {
  anthropic: { base_url: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001' },
  openai: { base_url: 'https://api.openai.com', model: 'gpt-4o-mini' },
  gemini: { base_url: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash' },
  ollama: { base_url: 'http://localhost:11434', model: 'llama3.2' },
};

export function LlmForm({ initialValues, detectedRefs = [], onSaved, submitLabel }: Props): JSX.Element {
  const [provider, setProvider] = useState<LlmProvider>(initialValues?.provider ?? 'anthropic');
  const [baseUrl, setBaseUrl] = useState(initialValues?.base_url ?? PROVIDER_DEFAULTS.anthropic.base_url);
  const [model, setModel] = useState(initialValues?.model ?? PROVIDER_DEFAULTS.anthropic.model);
  const [authToken, setAuthToken] = useState(() => {
    if (initialValues?.auth_token) return initialValues.auth_token;
    const hasAnthropicKey = detectedRefs.includes('ANTHROPIC_API_KEY');
    const hasAnthropicToken = detectedRefs.includes('ANTHROPIC_AUTH_TOKEN');
    if (hasAnthropicToken) return '${ANTHROPIC_AUTH_TOKEN}';
    if (hasAnthropicKey) return '${ANTHROPIC_API_KEY}';
    return '';
  });
  const [noAuth, setNoAuth] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isLocal = LOCALHOST_RE.test(baseUrl);
  const detectedAnthropic = detectedRefs.includes('ANTHROPIC_API_KEY') || detectedRefs.includes('ANTHROPIC_AUTH_TOKEN');

  const handleProviderChange = (newProvider: LlmProvider) => {
    setProvider(newProvider);
    const defaults = PROVIDER_DEFAULTS[newProvider];
    setBaseUrl(defaults.base_url);
    setModel(defaults.model);
    setNoAuth(newProvider === 'ollama');
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const payload: LlmConfig = {
        provider,
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
      setSuccess(true);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message ?? 'failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-xl">
      <label className="flex flex-col gap-1 text-sm">
        Provider
        <select
          aria-label="provider"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as LlmProvider)}
          disabled={submitting}
          className="bg-bg-elevated px-3 py-2 rounded text-sm"
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
          <option value="gemini">Google Gemini</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </label>

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
      {success && <div className="text-accent text-sm">✓ Saved — connection verified.</div>}

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-accent text-bg-primary rounded text-sm"
        >
          {submitting ? 'Testing…' : submitLabel ?? 'Test & Save'}
        </button>
      </div>
    </form>
  );
}
