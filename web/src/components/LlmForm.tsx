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

const PROVIDER_ENV_REFS: Record<LlmProvider, string[]> = {
  anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  ollama: [],
};

export function LlmForm({ initialValues, detectedRefs = [], onSaved, submitLabel }: Props): JSX.Element {
  const initialProvider = initialValues?.provider ?? 'anthropic';
  const initialDefaults = PROVIDER_DEFAULTS[initialProvider];
  const initialBaseUrl = initialValues?.base_url ?? initialDefaults.base_url;
  const [provider, setProvider] = useState<LlmProvider>(initialProvider);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [model, setModel] = useState(initialValues?.model ?? initialDefaults.model);
  const [authToken, setAuthToken] = useState(() => {
    if (initialValues?.auth_token) return initialValues.auth_token;
    return defaultAuthRef(initialProvider, detectedRefs);
  });
  const [noAuth, setNoAuth] = useState(() => initialProvider === 'ollama' || (initialValues?.hasAuth === false && LOCALHOST_RE.test(initialBaseUrl)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isLocal = LOCALHOST_RE.test(baseUrl);
  const authRefDetected = ENV_REF_RE.test(authToken) && detectedRefs.includes(authToken.slice(2, -1));

  const handleProviderChange = (newProvider: LlmProvider) => {
    setProvider(newProvider);
    const defaults = PROVIDER_DEFAULTS[newProvider];
    setBaseUrl(defaults.base_url);
    setModel(defaults.model);
    setNoAuth(newProvider === 'ollama');
    setAuthToken(defaultAuthRef(newProvider, detectedRefs));
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
            placeholder={authPlaceholder(provider)}
            className="bg-bg-elevated px-3 py-2 rounded font-mono text-sm"
          />
          {authRefDetected && (
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

function defaultAuthRef(provider: LlmProvider, detectedRefs: string[]): string {
  const detected = PROVIDER_ENV_REFS[provider].find((ref) => detectedRefs.includes(ref));
  return detected ? `\${${detected}}` : '';
}

function authPlaceholder(provider: LlmProvider): string {
  const first = PROVIDER_ENV_REFS[provider][0];
  return first ? `\${${first}} or paste a literal value` : 'No token required';
}
