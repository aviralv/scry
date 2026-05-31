import { useState, useId, type JSX, type KeyboardEvent } from 'react';

interface Props {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Visually hide the label (keep it in the DOM for screen readers). */
  hideLabel?: boolean;
}

export function ChipsInput({ label, values, onChange, placeholder, disabled, hideLabel }: Props): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  };

  const removeAt = (i: number) => {
    onChange(values.filter((_, j) => j !== i));
  };

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-text-tertiary text-xs'}>{label}</label>
      <div className="flex flex-wrap gap-1 items-center bg-bg-elevated px-2 py-1 rounded">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="bg-bg-secondary text-text-primary px-2 py-0.5 rounded text-xs flex items-center gap-1">
            {v}
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={disabled}
              aria-label={`remove ${v}`}
              className="text-text-tertiary hover:text-text-primary disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled}
          placeholder={placeholder}
          className="bg-transparent outline-none flex-1 min-w-[80px] text-sm disabled:opacity-50"
        />
      </div>
    </div>
  );
}
