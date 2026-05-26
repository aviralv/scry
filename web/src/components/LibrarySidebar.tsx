// web/src/components/LibrarySidebar.tsx
import { useEffect, useState, useCallback, type JSX } from 'react';
import type { SessionRow as SessionRowData } from '@shared/types.js';
import { listSessions, patchSession, deleteSession } from '../lib/sessions.js';
import { SessionRow } from './SessionRow.js';

interface Props {
  activeSessionId?: string;
  refreshKey: number;
  onSelect: (id: string) => void;
  onNewSearch: () => void;
}

interface Bucket {
  label: string;
  rows: SessionRowData[];
}

const DAY_MS = 86_400_000;

function bucketize(rows: SessionRowData[]): Bucket[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = today.getTime() - 6 * DAY_MS;

  const buckets: Bucket[] = [
    { label: 'Today', rows: [] },
    { label: 'Yesterday', rows: [] },
    { label: 'Last week', rows: [] },
    { label: 'Older', rows: [] },
  ];
  for (const r of rows) {
    if (r.updatedAt >= today.getTime()) buckets[0].rows.push(r);
    else if (r.updatedAt >= yesterday.getTime()) buckets[1].rows.push(r);
    else if (r.updatedAt >= lastWeek) buckets[2].rows.push(r);
    else buckets[3].rows.push(r);
  }
  return buckets.filter((b) => b.rows.length > 0);
}

export function LibrarySidebar({ activeSessionId, refreshKey, onSelect, onNewSearch }: Props): JSX.Element {
  const [rows, setRows] = useState<SessionRowData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await listSessions({ limit: 100 });
      setRows(r);
      setError(null);
    } catch (err) {
      setError((err as Error).message ?? 'failed to load');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const handleRename = useCallback(async (id: string, newTitle: string) => {
    await patchSession(id, { title: newTitle });
    await refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteSession(id);
    if (activeSessionId === id) onNewSearch();
    await refresh();
  }, [activeSessionId, onNewSearch, refresh]);

  if (collapsed) {
    return (
      <aside className="w-10 border-r border-border bg-bg-secondary flex flex-col items-center py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-text-tertiary hover:text-text-primary"
          aria-label="Expand sidebar"
        >
          ›
        </button>
      </aside>
    );
  }

  const buckets = bucketize(rows);

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-bg-secondary flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-text-primary text-sm font-sans">Library</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-text-tertiary hover:text-text-primary text-sm"
          aria-label="Collapse sidebar"
        >
          ‹
        </button>
      </div>
      <button
        type="button"
        onClick={onNewSearch}
        className="m-2 px-3 py-1.5 rounded border border-accent-dim text-accent hover:bg-bg-elevated text-sm text-left"
      >
        + New search
      </button>
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-2 text-error text-xs">⚠ {error}</div>
        )}
        {buckets.length === 0 && !error && (
          <div className="m-2 text-text-tertiary text-xs italic">No sessions yet.</div>
        )}
        {buckets.map((b) => (
          <div key={b.label} className="mb-3">
            <div className="px-3 py-1 text-text-tertiary text-xs font-mono">{b.label}</div>
            {b.rows.map((r) => (
              <SessionRow
                key={r.id}
                row={r}
                isActive={r.id === activeSessionId}
                onSelect={() => onSelect(r.id)}
                onRename={(t) => handleRename(r.id, t)}
                onDelete={() => handleDelete(r.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
