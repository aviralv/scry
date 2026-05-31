import { useState, type JSX } from 'react';
import type { Person, ApiErrorIssue } from '@shared/types.js';
import { ChipsInput } from './ChipsInput.js';

interface Props {
  entryKey: string;
  person: Person;
  dirty: boolean;
  errors: ApiErrorIssue[];
  onChange: (next: Person) => void;
  onDelete: () => void;
}

function getError(errors: ApiErrorIssue[], ...path: string[]): string | undefined {
  // Match issues whose path starts with the given suffix relative to the row.
  // Row's path prefix is ["people", entryKey, ...path]; issues already filtered
  // by row, so issue.path[2..] should match the suffix.
  return errors.find((i) => path.every((seg, idx) => i.path[2 + idx] === seg))?.message;
}

export function PersonRow({ entryKey, person, dirty, errors, onChange, onDelete }: Props): JSX.Element {
  // Auto-expand when there are errors so the user can see the offending field.
  const [expanded, setExpanded] = useState(errors.length > 0);

  const update = (patch: Partial<Person>) => onChange({ ...person, ...patch });
  const updateIdent = (patch: Partial<Person['identifiers']>) =>
    onChange({ ...person, identifiers: { ...person.identifiers, ...patch } });

  const summary = [person.role, (person.teams ?? []).join('/')].filter(Boolean).join(' · ');

  return (
    <div className="border-b border-border" data-testid={`person-row-${entryKey}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? 'collapse' : 'expand'}
          className="text-text-tertiary hover:text-text-primary text-sm"
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="font-mono text-xs text-text-tertiary w-32 shrink-0">{entryKey}</span>
        <span className="text-text-primary text-sm flex-1">{person.name}</span>
        {summary && <span className="text-text-tertiary text-xs">{summary}</span>}
        {dirty && <span aria-label="dirty" className="w-2 h-2 bg-accent rounded-full" />}
        <button
          type="button"
          onClick={onDelete}
          className="text-error hover:underline text-xs"
          aria-label={`delete ${entryKey}`}
        >
          Delete
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pl-12 flex flex-col gap-2 bg-bg-secondary/30">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={person.name}
              onChange={(e) => update({ name: e.target.value })}
              className="bg-bg-elevated px-2 py-1 rounded"
            />
            {getError(errors, 'name') && <span className="text-error text-xs">{getError(errors, 'name')}</span>}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <input
              value={person.role ?? ''}
              onChange={(e) => update({ role: e.target.value || undefined })}
              className="bg-bg-elevated px-2 py-1 rounded"
            />
          </label>
          <ChipsInput label="teams" values={person.teams ?? []} onChange={(v) => update({ teams: v.length ? v : undefined })} />
          <ChipsInput label="aliases" values={person.aliases ?? []} onChange={(v) => update({ aliases: v.length ? v : undefined })} />
          <ChipsInput label="projects" values={person.projects ?? []} onChange={(v) => update({ projects: v.length ? v : undefined })} />

          <fieldset className="flex flex-col gap-2 border border-border rounded p-2">
            <legend className="text-xs text-text-tertiary px-1">identifiers</legend>
            <label className="flex flex-col gap-1 text-xs">
              slack_username
              <input
                value={person.identifiers.slack_username ?? ''}
                onChange={(e) => updateIdent({ slack_username: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              email
              <input
                value={person.identifiers.email ?? ''}
                onChange={(e) => updateIdent({ email: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded"
              />
              {getError(errors, 'identifiers', 'email') && (
                <span className="text-error text-xs">{getError(errors, 'identifiers', 'email')}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-xs">
              confluence_username
              <input
                value={person.identifiers.confluence_username ?? ''}
                onChange={(e) => updateIdent({ confluence_username: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded"
              />
            </label>
          </fieldset>
        </div>
      )}
    </div>
  );
}
