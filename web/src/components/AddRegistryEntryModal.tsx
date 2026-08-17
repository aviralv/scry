import { useState, type JSX, type FormEvent } from 'react';

const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;

interface Props {
  group: 'people' | 'projects';
  existingKeys: string[];
  onConfirm: (entry: { key: string; name: string }) => void;
  onClose: () => void;
}

export function AddRegistryEntryModal({ group, existingKeys, onConfirm, onClose }: Props): JSX.Element {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = group === 'people' ? 'Add Person' : 'Add Project';
  const keyPlaceholder = group === 'people' ? 'andre-c' : 'ea';
  const namePlaceholder = group === 'people' ? 'Andre Christ' : 'Enterprise Architecture';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!SLUG_RE.test(key)) {
      setError('Key must be a lowercase slug (letters, digits, _, -; starts with a letter)');
      return;
    }
    if (existingKeys.includes(key)) {
      setError(`Key "${key}" already exists in ${group}`);
      return;
    }
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    onConfirm({ key, name: name.trim() });
    onClose();
  };

  const updateName = (nextName: string) => {
    setName(nextName);
    if (!keyEdited) setKey(slugify(nextName));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-bg-secondary p-6 rounded w-[420px] flex flex-col gap-3">
        <h2 className="text-text-primary text-lg">{title}</h2>

        <label className="flex flex-col gap-1 text-sm">
          Key
          <input
            value={key}
            onChange={(e) => {
              setKeyEdited(true);
              setKey(e.target.value);
            }}
            required
            placeholder={keyPlaceholder}
            className="bg-bg-elevated px-2 py-1 rounded font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={name}
            onChange={(e) => updateName(e.target.value)}
            required
            placeholder={namePlaceholder}
            className="bg-bg-elevated px-2 py-1 rounded"
          />
        </label>

        {error && <div role="alert" className="text-error text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-text-tertiary">Cancel</button>
          <button type="submit" className="px-3 py-1 bg-accent text-bg-primary rounded">Add</button>
        </div>
      </form>
    </div>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
}
