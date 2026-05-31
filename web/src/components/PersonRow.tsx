import { useState, useEffect, type JSX } from 'react';
import type { Person, ApiErrorIssue } from '@shared/types.js';
import { ChipsInput } from './ChipsInput.js';

interface Props {
  entryKey: string;
  person: Person;
  dirty: boolean;
  errors: ApiErrorIssue[];
  defaultExpanded?: boolean;
  onChange: (next: Person) => void;
  onDelete: () => void;
}

function getError(errors: ApiErrorIssue[], ...path: string[]): string | undefined {
  // Match issues whose path starts with the given suffix relative to the row.
  // Row's path prefix is ["people", entryKey, ...path]; issues already filtered
  // by row, so issue.path[2..] should match the suffix.
  return errors.find((i) => path.every((seg, idx) => i.path[2 + idx] === seg))?.message;
}

// Returns true if any reported error targets a field beyond the always-visible
// set (name, role, teams) — used to auto-open the "More fields" section.
function hasExtendedError(errors: ApiErrorIssue[]): boolean {
  const PRIMARY = new Set(['name', 'role', 'teams']);
  return errors.some((i) => {
    const field = i.path[2];
    return field !== undefined && !PRIMARY.has(String(field));
  });
}

export function PersonRow({ entryKey, person, dirty, errors, defaultExpanded, onChange, onDelete }: Props): JSX.Element {
  // Show the "More fields" section by default for newly-added rows or when an
  // error points at a field that lives there.
  const [showMore, setShowMore] = useState(defaultExpanded === true || hasExtendedError(errors));

  // Reopen "More fields" if a fresh validation error targets an extended
  // field after initial mount (e.g. the user clicks Save and the server
  // returns 400 for an email field).
  useEffect(() => {
    if (hasExtendedError(errors)) setShowMore(true);
  }, [errors]);

  const update = (patch: Partial<Person>) => onChange({ ...person, ...patch });
  const updateIdent = (patch: Partial<Person['identifiers']>) =>
    onChange({ ...person, identifiers: { ...person.identifiers, ...patch } });

  return (
    <div className="border-b border-border py-3 px-3" data-testid={`person-row-${entryKey}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-xs text-text-tertiary w-32 shrink-0">{entryKey}</span>
        <span className="text-text-tertiary text-xs flex-1" />
        {dirty && <span aria-hidden="true" className="w-2 h-2 bg-accent rounded-full" />}
        <button
          type="button"
          onClick={onDelete}
          className="text-error hover:underline text-xs"
          aria-label={`delete ${entryKey}`}
        >
          Delete
        </button>
      </div>

      <div className="flex flex-col gap-2 pl-32">
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
            placeholder="CPO, EM, Designer…"
          />
        </label>
        <ChipsInput
          label="teams"
          values={person.teams ?? []}
          onChange={(v) => update({ teams: v.length ? v : undefined })}
          placeholder="press Enter to add"
        />

        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          aria-label={showMore ? 'hide more fields' : 'show more fields'}
          aria-expanded={showMore}
          className="self-start text-text-tertiary hover:text-text-primary text-xs mt-1"
        >
          {showMore ? '− Less' : '+ More fields (aliases, projects, identifiers)'}
        </button>

        {showMore && (
          <div className="flex flex-col gap-2 pt-1">
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
    </div>
  );
}
