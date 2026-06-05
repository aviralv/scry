import { useState, useEffect, useCallback, type JSX } from 'react';
import { discoverMcps, type BundledServerView } from '../../lib/mcps-discover.js';
import { addOnboardingMcp, skipStep } from '../../lib/onboarding.js';
import type { McpServerEntry, McpInput } from '../../lib/mcps.js';
import { OnboardingMcpCard, type CardStatus } from './OnboardingMcpCard.js';
import { McpAddModal } from '../McpAddModal.js';

interface Props {
  initialMcps: McpServerEntry[];
  detectedEnvKeys: string[];
  onAdvance: () => void;
}

interface CardState {
  picked: boolean;
  envValues: Record<string, string>;
  overrides: Set<string>;
  status: CardStatus;
  errorMessage?: string;
}

interface CustomEntry {
  input: McpInput;
  status: CardStatus;
  errorMessage?: string;
}

export function OnboardingMcps({ initialMcps, detectedEnvKeys, onAdvance }: Props): JSX.Element {
  const [bundled, setBundled] = useState<BundledServerView[]>([]);
  const [pathInstalled, setPathInstalled] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [customs, setCustoms] = useState<CustomEntry[]>([]);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    void discoverMcps()
      .then((r) => {
        setBundled(r.bundled);
        setPathInstalled(new Set(r.pathInstalled));
        // Pre-pick MCPs already in initialMcps (re-entry).
        const next: Record<string, CardState> = {};
        for (const b of r.bundled) {
          const existing = initialMcps.find(m => m.name === b.slug);
          next[b.slug] = {
            picked: existing !== undefined,
            envValues: {},
            overrides: new Set<string>(),
            status: existing ? 'ok' : 'idle',
          };
        }
        setCards(next);
      })
      .catch((err) => {
        setGlobalError((err as Error).message ?? 'Failed to load MCP list');
      });
  }, [initialMcps]);

  const setPicked = useCallback((slug: string, picked: boolean) => {
    setCards(c => ({ ...c, [slug]: { ...c[slug], picked, status: 'idle', errorMessage: undefined } }));
  }, []);
  const setEnv = useCallback((slug: string, key: string, value: string) => {
    setCards(c => ({ ...c, [slug]: { ...c[slug], envValues: { ...c[slug].envValues, [key]: value } } }));
  }, []);
  const dropCard = useCallback((slug: string) => {
    setCards(c => ({ ...c, [slug]: { ...c[slug], picked: false, status: 'idle', errorMessage: undefined } }));
  }, []);
  const setOverride = useCallback((slug: string, key: string) => {
    setCards(c => ({
      ...c,
      [slug]: {
        ...c[slug],
        overrides: new Set([...c[slug].overrides, key]),
        envValues: { ...c[slug].envValues, [key]: '' },
      },
    }));
  }, []);

  const dropCustom = (idx: number) => {
    setCustoms(cs => cs.filter((_, i) => i !== idx));
  };

  const handleCustomSubmit = useCallback((input: McpInput) => {
    setCustoms(cs => [...cs, { input, status: 'idle' }]);
    setShowCustomModal(false);
    return Promise.resolve();
  }, []);

  const testAndContinue = async () => {
    const picked = Object.entries(cards).filter(([, s]) => s.picked);
    const allPicked = [
      ...picked.map(([slug, state]) => ({ kind: 'bundled' as const, slug, bundled: bundled.find(b => b.slug === slug)!, state })),
      ...customs.map((c, idx) => ({ kind: 'custom' as const, idx, custom: c })),
    ];
    if (allPicked.length === 0) {
      setGlobalError('Pick at least one MCP, or click Skip below.');
      return;
    }
    setSubmitting(true);
    setGlobalError(null);

    // Mark all picked as testing.
    setCards(c => {
      const next = { ...c };
      for (const [slug] of picked) next[slug] = { ...next[slug], status: 'testing' };
      return next;
    });
    setCustoms(cs => cs.map(c => ({ ...c, status: 'testing' })));

    const promises = allPicked.map(async (p) => {
      try {
        if (p.kind === 'bundled') {
          const allKeys = p.bundled.envVars ?? [];
          const userTyped = p.state.envValues;
          const envRefs = allKeys.filter(k =>
            detectedEnvKeys.includes(k) && !p.state.overrides.has(k)
          );

          // Validate: every required env key must be either prefilled (detected + not overridden)
          // or user-typed (non-empty in envValues). A blank, non-detected key is a failure.
          const missing = allKeys.filter(k =>
            !envRefs.includes(k) && (!userTyped[k] || userTyped[k].trim() === '')
          );
          if (missing.length > 0) {
            const msg = `Missing required env: ${missing.join(', ')}`;
            setCards(c => ({ ...c, [p.slug]: { ...c[p.slug], status: 'error', errorMessage: msg } }));
            return { ok: false, key: p.slug };
          }

          await addOnboardingMcp({
            name: p.slug,
            command: p.bundled.command,
            // Trim leading/trailing whitespace — pasted tokens often carry spaces.
            envValues: Object.fromEntries(
              Object.entries(userTyped).map(([k, v]) => [k, v.trim()])
            ),
            envRefs,
          });
          setCards(c => ({ ...c, [p.slug]: { ...c[p.slug], status: 'ok' } }));
          return { ok: true, key: p.slug };
        } else {
          const inp = p.custom.input;
          const envValues: Record<string, string> = {};
          for (const [k, v] of Object.entries(inp.env ?? {})) {
            envValues[k] = v;
          }
          await addOnboardingMcp({ name: inp.name, command: inp.command, args: inp.args, envValues });
          setCustoms(cs => cs.map((c, i) => i === p.idx ? { ...c, status: 'ok' } : c));
          return { ok: true, key: inp.name };
        }
      } catch (err) {
        const msg = (err as Error).message ?? 'failed';
        if (p.kind === 'bundled') {
          setCards(c => ({ ...c, [p.slug]: { ...c[p.slug], status: 'error', errorMessage: msg } }));
        } else {
          setCustoms(cs => cs.map((c, i) => i === p.idx ? { ...c, status: 'error', errorMessage: msg } : c));
        }
        return { ok: false, key: p.kind === 'bundled' ? p.slug : p.custom.input.name };
      }
    });

    const results = await Promise.all(promises);
    setSubmitting(false);

    const anyOk = results.some(r => r.ok);
    if (anyOk) onAdvance();
    else setGlobalError('No MCPs succeeded. Fix the errors above or skip below.');
  };

  const handleSkip = async () => {
    if (!window.confirm('Search will return "no sources configured" until you add an MCP. Continue?')) return;
    setSubmitting(true);
    try {
      await skipStep('mcps');
      onAdvance();
    } catch (err) {
      setGlobalError((err as Error).message ?? 'skip failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <h2 className="text-text-primary text-xl">Step 2 — Pick the search sources scry will use</h2>
      <p className="text-text-tertiary text-sm">
        Each picked MCP shows the env vars it needs. They'll be saved to <code className="text-xs">.scry.env</code> and referenced from your config.
      </p>

      <div className="flex flex-col gap-3">
        {(() => {
          const envKeySet = new Set(detectedEnvKeys);
          return bundled.map((b) => (
            <OnboardingMcpCard
              key={b.slug}
              bundled={b}
              picked={cards[b.slug]?.picked ?? false}
              envValues={cards[b.slug]?.envValues ?? {}}
              detectedEnvKeys={envKeySet}
              overrides={cards[b.slug]?.overrides ?? new Set()}
              onPath={pathInstalled.has(b.command)}
              statusKind={cards[b.slug]?.status ?? 'idle'}
              errorMessage={cards[b.slug]?.errorMessage}
              onPickedChange={(p) => setPicked(b.slug, p)}
              onEnvChange={(k, v) => setEnv(b.slug, k, v)}
              onOverride={(k) => setOverride(b.slug, k)}
              onDrop={() => dropCard(b.slug)}
            />
          ));
        })()}

        {customs.map((c, idx) => (
          <div key={`custom-${idx}`} className={`p-4 border rounded ${c.status === 'error' ? 'border-error' : 'border-accent bg-accent/5'}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="text-text-primary font-medium text-sm">{c.input.name} <span className="text-xs text-text-tertiary">(custom)</span></div>
                <div className="text-text-tertiary text-xs mt-0.5 font-mono">{c.input.command} {c.input.args?.join(' ')}</div>
              </div>
            </div>
            {c.status === 'error' && (
              <div className="mt-3 flex items-center gap-3">
                <span role="alert" className="text-xs text-error flex-1">{c.errorMessage}</span>
                <button type="button" onClick={() => dropCustom(idx)} className="text-xs underline text-text-tertiary">
                  Drop &amp; continue
                </button>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setShowCustomModal(true)}
          disabled={submitting}
          className="p-4 border border-dashed border-border rounded text-text-tertiary text-sm hover:bg-bg-elevated"
        >
          + Add custom MCP
        </button>
      </div>

      {globalError && <div role="alert" className="text-error text-sm">{globalError}</div>}

      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-text-tertiary text-xs underline"
        >
          I'll configure MCPs later — search will be unavailable
        </button>
        <button
          type="button"
          onClick={testAndContinue}
          disabled={submitting}
          className="px-4 py-2 bg-accent text-bg-primary rounded text-sm"
        >
          {submitting ? 'Testing…' : 'Test & Continue →'}
        </button>
      </div>

      {showCustomModal && (
        <McpAddModal
          mode="add"
          onSubmit={handleCustomSubmit}
          onClose={() => setShowCustomModal(false)}
        />
      )}
    </div>
  );
}
