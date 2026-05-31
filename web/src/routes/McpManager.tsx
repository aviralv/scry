import { useState, useEffect, useCallback, type JSX } from 'react';
import { ApiCallError } from '../lib/api.js';
import {
  listMcps, createMcp, updateMcp, deleteMcp, testMcp,
  type McpServerEntry, type McpInput, type McpPatchInput,
} from '../lib/mcps.js';
import { McpRow, type TestStatus } from '../components/McpRow.js';
import { McpAddModal } from '../components/McpAddModal.js';

type RowStatus = { status: TestStatus; errorMessage?: string };

export function McpManager(): JSX.Element {
  const [rows, setRows] = useState<McpServerEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsConfig, setNeedsConfig] = useState(false);
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; initial: McpServerEntry }>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listMcps();
      setRows(r);
      setNeedsConfig(false);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 412) {
        setNeedsConfig(true);
      } else {
        setLoadError((err as Error).message ?? 'failed to load');
      }
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = useCallback(async (input: McpInput) => {
    await createMcp(input);
    await refresh();
  }, [refresh]);

  const handleEdit = useCallback((server: McpServerEntry) => {
    setModal({ mode: 'edit', initial: server });
  }, []);

  const handlePatch = useCallback(async (name: string, input: McpPatchInput) => {
    await updateMcp(name, input);
    await refresh();
  }, [refresh]);

  const handleTest = useCallback(async (name: string) => {
    setStatuses((s) => ({ ...s, [name]: { status: 'testing' } }));
    try {
      const r = await testMcp(name);
      setStatuses((s) => ({ ...s, [name]: r.ok ? { status: 'ok' } : { status: 'error', errorMessage: r.error } }));
    } catch (err) {
      setStatuses((s) => ({ ...s, [name]: { status: 'error', errorMessage: (err as Error).message } }));
    }
  }, []);

  const handleDelete = useCallback(async (name: string) => {
    if (!window.confirm(`Delete MCP "${name}"?`)) return;
    setRows((rs) => rs.filter((r) => r.name !== name));   // optimistic
    try {
      await deleteMcp(name);
    } catch (err) {
      setLoadError((err as Error).message ?? 'delete failed');
      await refresh();                                    // restore on error
    }
  }, [refresh]);

  if (needsConfig) {
    return (
      <div className="p-6 text-text-tertiary">
        No config yet. Run scry through onboarding first.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-text-primary text-xl">MCP servers</h1>
        <button
          type="button"
          onClick={() => setModal({ mode: 'add' })}
          className="px-3 py-1 bg-accent text-bg-primary rounded text-sm"
        >
          + Add MCP
        </button>
      </div>
      {loadError && <div className="text-error text-sm mb-3">{loadError}</div>}
      <table className="w-full border border-border">
        <thead className="bg-bg-secondary text-text-tertiary text-xs">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Command</th>
            <th className="px-3 py-2 text-left">Args</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Enabled</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <McpRow
              key={s.name}
              server={s}
              status={statuses[s.name]?.status ?? 'never'}
              errorMessage={statuses[s.name]?.errorMessage}
              onEdit={() => handleEdit(s)}
              onTest={() => handleTest(s.name)}
              onDelete={() => handleDelete(s.name)}
            />
          ))}
        </tbody>
      </table>

      {modal?.mode === 'add' && (
        <McpAddModal
          mode="add"
          onSubmit={handleAdd}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'edit' && (
        <McpAddModal
          mode="edit"
          initial={modal.initial}
          onSubmit={(input) => handlePatch(modal.initial.name, input)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
