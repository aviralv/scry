// web/src/components/SessionRow.tsx
import { useState, type JSX } from 'react';
import type { SessionRow as SessionRowData } from '@shared/types.js';

interface Props {
  row: SessionRowData;
  isActive: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function SessionRow({ row, isActive, onSelect, onRename, onDelete }: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.title);

  const startRename = () => {
    setMenuOpen(false);
    setDraft(row.title);
    setEditing(true);
  };

  const commitRename = async () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === row.title) return;
    await onRename(trimmed);
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    await onDelete();
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-full bg-bg-elevated border border-accent rounded px-2 py-1 text-sm text-text-primary focus:outline-none"
        />
      </div>
    );
  }

  const className = [
    'group flex items-center justify-between px-2 py-1 rounded cursor-pointer text-sm',
    isActive ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-secondary',
  ].join(' ');

  return (
    <div className={className} onClick={onSelect} title={new Date(row.updatedAt).toLocaleString()}>
      <span className="truncate flex-1">{row.title}</span>
      <span className="relative">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          className="opacity-0 group-hover:opacity-100 px-1 text-text-tertiary hover:text-text-primary"
          aria-label="Session menu"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-10 bg-bg-elevated border border-border rounded shadow-md text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={startRename}
              className="block w-full text-left px-3 py-1 hover:bg-bg-secondary text-text-primary"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="block w-full text-left px-3 py-1 hover:bg-bg-secondary text-error"
            >
              Delete
            </button>
          </div>
        )}
      </span>
    </div>
  );
}
