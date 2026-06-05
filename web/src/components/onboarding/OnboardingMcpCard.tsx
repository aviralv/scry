import type { JSX } from 'react';
import type { BundledServerView } from '../../lib/mcps-discover.js';

export type CardStatus = 'idle' | 'testing' | 'ok' | 'error';

interface Props {
  bundled: BundledServerView;
  picked: boolean;
  envValues: Record<string, string>;
  onPath: boolean;
  statusKind: CardStatus;
  errorMessage?: string;
  onPickedChange: (picked: boolean) => void;
  onEnvChange: (key: string, value: string) => void;
  onDrop?: () => void;
}

export function OnboardingMcpCard({
  bundled, picked, envValues, onPath, statusKind, errorMessage,
  onPickedChange, onEnvChange, onDrop,
}: Props): JSX.Element {
  return (
    <div className={`p-4 border rounded ${picked ? 'border-accent bg-accent/5' : 'border-border'}`}>
      <div className="flex justify-between items-start gap-3">
        <label className="flex items-start gap-2 flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={picked}
            onChange={(e) => onPickedChange(e.target.checked)}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="text-text-primary font-medium text-sm">{bundled.name}</div>
            <div className="text-text-tertiary text-xs mt-0.5">{bundled.description}</div>
          </div>
        </label>
        <div className="text-xs shrink-0">
          {onPath
            ? <span className="text-success">✓ {bundled.command} on PATH</span>
            : <span className="text-error">✗ {bundled.command} not found</span>}
        </div>
      </div>

      {picked && bundled.envVars && bundled.envVars.length > 0 && (
        <div className="mt-3 ml-6 space-y-2">
          {bundled.envVars.map((key) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-xs text-text-secondary w-40 shrink-0">{key}</span>
              <input
                aria-label={key}
                type="password"
                value={envValues[key] ?? ''}
                onChange={(e) => onEnvChange(key, e.target.value)}
                className="bg-bg-elevated px-2 py-1 rounded flex-1 font-mono text-xs"
              />
            </label>
          ))}
        </div>
      )}

      {!picked && !onPath && (
        <div className="mt-3 ml-6 px-3 py-2 bg-bg-elevated rounded font-mono text-xs text-text-tertiary">
          uv tool install git+{bundled.githubUrl}
        </div>
      )}

      {statusKind === 'testing' && <div className="mt-3 ml-6 text-xs text-text-tertiary">Testing…</div>}
      {statusKind === 'ok' && <div className="mt-3 ml-6 text-xs text-success">✓ Health-check passed</div>}
      {statusKind === 'error' && (
        <div className="mt-3 ml-6 flex items-center gap-3">
          <span role="alert" className="text-xs text-error flex-1">{errorMessage ?? 'failed'}</span>
          {onDrop && (
            <button type="button" onClick={onDrop} className="text-xs underline text-text-tertiary">
              Drop &amp; continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}
