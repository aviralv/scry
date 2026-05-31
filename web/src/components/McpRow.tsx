import type { JSX } from 'react';
import type { McpServerEntry } from '../lib/mcps.js';

export type TestStatus = 'never' | 'ok' | 'error' | 'testing';

interface Props {
  server: McpServerEntry;
  status: TestStatus;
  errorMessage?: string;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}

const STATUS_LABEL: Record<TestStatus, string> = {
  never: '⚪ Never tested',
  ok: '🟢 OK',
  error: '🔴 Failed',
  testing: '… Testing',
};

export function McpRow({ server, status, errorMessage, onEdit, onTest, onDelete }: Props): JSX.Element {
  return (
    <tr className="border-b border-border">
      <td className="px-3 py-2 font-mono text-sm">{server.name}</td>
      <td className="px-3 py-2 font-mono text-xs text-text-tertiary">{server.command}</td>
      <td className="px-3 py-2 text-xs text-text-tertiary">
        {(server.args ?? []).join(' ') || '—'}
      </td>
      <td className="px-3 py-2 text-sm" title={errorMessage}>{STATUS_LABEL[status]}</td>
      <td className="px-3 py-2 text-sm">{server.enabled ? '✓' : '—'}</td>
      <td className="px-3 py-2 text-sm">
        <button onClick={onEdit} className="text-accent hover:underline mr-3">Edit</button>
        <button onClick={onTest} className="text-accent hover:underline mr-3" disabled={status === 'testing'}>Test</button>
        <button onClick={onDelete} className="text-error hover:underline">Delete</button>
      </td>
    </tr>
  );
}
