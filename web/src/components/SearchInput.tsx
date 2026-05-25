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
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ask anything across your sources..."
        disabled={disabled}
        autoFocus
        className={[
          'w-full p-3 rounded border border-border',
          'bg-bg-elevated text-text-primary placeholder:text-text-tertiary',
          'font-sans text-base',
          'focus:outline-none focus:ring-2 focus:ring-accent',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        ].join(' ')}
      />
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
