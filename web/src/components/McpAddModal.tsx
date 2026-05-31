import { useState, type JSX, type FormEvent } from 'react';
import type { McpServerEntry, McpInput, McpPatchInput } from '../lib/mcps.js';

interface AddProps {
  mode: 'add';
  onSubmit: (input: McpInput) => Promise<void>;
  onClose: () => void;
}
interface EditProps {
  mode: 'edit';
  initial: McpServerEntry;
  onSubmit: (input: McpPatchInput) => Promise<void>;
  onClose: () => void;
}
type Props = AddProps | EditProps;

const ENV_REF_RE = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export function McpAddModal(props: Props): JSX.Element {
  const initial: McpServerEntry | null = props.mode === 'edit' ? props.initial : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [argsText, setArgsText] = useState((initial?.args ?? []).join('\n'));
  const [envRows, setEnvRows] = useState<{ key: string; value: string }[]>(
    initial?.env ? Object.entries(initial.env).map(([k, v]) => ({ key: k, value: v })) : [],
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddEnv = () => setEnvRows((rs) => [...rs, { key: '', value: '' }]);
  const handleEnvChange = (i: number, field: 'key' | 'value', v: string) =>
    setEnvRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: v } : r)));
  const handleEnvRemove = (i: number) => setEnvRows((rs) => rs.filter((_, j) => j !== i));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Client-side env-value check.
    for (const r of envRows) {
      if (r.key && r.value && !ENV_REF_RE.test(r.value)) {
        setError(`env "${r.key}" must be \${NAME} reference, not a literal`);
        return;
      }
    }
    const args = argsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const env: Record<string, string> = {};
    for (const r of envRows) if (r.key && r.value) env[r.key] = r.value;

    const payload = {
      command,
      args: args.length ? args : undefined,
      env: Object.keys(env).length ? env : undefined,
      enabled,
    };

    setSubmitting(true);
    try {
      if (props.mode === 'add') await props.onSubmit({ name, ...payload });
      else await props.onSubmit(payload);
    } catch (err) {
      setError((err as Error).message ?? 'failed');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    props.onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-bg-secondary p-6 rounded w-[480px] flex flex-col gap-3">
        <h2 className="text-text-primary text-lg">{props.mode === 'add' ? 'Add MCP' : `Edit ${initial?.name}`}</h2>

        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting || props.mode === 'edit'}
            required
            pattern="[a-z][a-z0-9_-]{0,63}"
            className="bg-bg-elevated px-2 py-1 rounded"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Command
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={submitting}
            required
            className="bg-bg-elevated px-2 py-1 rounded"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Args (one per line)
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            disabled={submitting}
            rows={3}
            className="bg-bg-elevated px-2 py-1 rounded font-mono text-xs"
          />
        </label>

        <fieldset className="flex flex-col gap-1 text-sm" disabled={submitting}>
          <legend>Env (use ${'{NAME}'} refs only)</legend>
          {envRows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label="env key"
                value={r.key}
                onChange={(e) => handleEnvChange(i, 'key', e.target.value)}
                placeholder="TOKEN"
                className="bg-bg-elevated px-2 py-1 rounded flex-1"
              />
              <input
                aria-label="env value"
                value={r.value}
                onChange={(e) => handleEnvChange(i, 'value', e.target.value)}
                placeholder="${SLACK_TOKEN}"
                className="bg-bg-elevated px-2 py-1 rounded flex-1"
              />
              <button type="button" onClick={() => handleEnvRemove(i)} className="text-text-tertiary">×</button>
            </div>
          ))}
          <button type="button" onClick={handleAddEnv} className="self-start text-accent text-xs mt-1">+ Add env</button>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={submitting}
          />
          Enabled
        </label>

        {error && <div role="alert" className="text-error text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} disabled={submitting} className="px-3 py-1 text-text-tertiary">Cancel</button>
          <button type="submit" disabled={submitting} aria-label="Save" className="px-3 py-1 bg-accent text-bg-primary rounded">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
