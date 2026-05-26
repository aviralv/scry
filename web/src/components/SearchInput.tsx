import { useState, type FormEvent, type JSX } from 'react';

interface Props {
  disabled?: boolean;
  onSubmit: (query: string, fanoutMode: boolean) => void;
}

export function SearchInput({ disabled, onSubmit }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [fanoutMode, setFanoutMode] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed, fanoutMode);
  }

  return (
    <form onSubmit={handleSubmit} className="search-input w-full max-w-2xl">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything across your sources..."
          disabled={disabled}
          autoFocus
          className={[
            'flex-1 p-3 rounded border border-border',
            'bg-bg-elevated text-text-primary placeholder:text-text-tertiary',
            'font-sans text-base',
            'focus:outline-none focus:ring-2 focus:ring-accent',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          ].join(' ')}
        />
        <button
          type="submit"
          disabled={disabled || query.trim().length === 0}
          className={[
            'px-4 rounded border border-accent-dim',
            'bg-accent text-bg-primary font-sans text-sm font-medium',
            'hover:bg-accent-dim hover:text-text-primary',
            'focus:outline-none focus:ring-2 focus:ring-accent',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'transition-colors duration-150',
          ].join(' ')}
        >
          Search
        </button>
      </div>
      <label className="inline-flex items-center gap-2 mt-2 text-text-tertiary text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={fanoutMode}
          onChange={(e) => setFanoutMode(e.target.checked)}
          disabled={disabled}
        />
        Fanout mode (force all configured tools first turn)
      </label>
    </form>
  );
}
