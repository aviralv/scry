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
  return errors.find((i) => path.every((seg, idx) => i.path[2 + idx] === seg))?.message;
}

function hasExtendedError(errors: ApiErrorIssue[]): boolean {
  const PRIMARY = new Set(['name', 'role', 'teams']);
  return errors.some((i) => {
    const field = i.path[2];
    return field !== undefined && !PRIMARY.has(String(field));
  });
}

export function PersonRow({ entryKey, person, dirty, errors, defaultExpanded, onChange, onDelete }: Props): JSX.Element {
  const [showMore, setShowMore] = useState(defaultExpanded === true || hasExtendedError(errors));

  useEffect(() => {
    if (hasExtendedError(errors)) setShowMore(true);
  }, [errors]);

  const update = (patch: Partial<Person>) => onChange({ ...person, ...patch });
  const updateIdent = (patch: Partial<Person['identifiers']>) =>
    onChange({ ...person, identifiers: { ...person.identifiers, ...patch } });

  const nameError = getError(errors, 'name');
  const emailError = getError(errors, 'identifiers', 'email');

  return (
    <>
      <tr className="border-b border-border align-top" data-testid={`person-row-${entryKey}`}>
        <td className="px-3 py-2 font-mono text-xs text-text-tertiary whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              aria-label={showMore ? 'hide more fields' : 'show more fields'}
              aria-expanded={showMore}
              className="text-text-tertiary hover:text-text-primary"
            >
              {showMore ? '▾' : '▸'}
            </button>
            <span>{entryKey}</span>
            {dirty && <span aria-hidden="true" className="w-1.5 h-1.5 bg-accent rounded-full" />}
          </div>
        </td>
        <td className="px-3 py-2 w-[22%]">
          <input
            aria-label={`${entryKey} name`}
            value={person.name}
            onChange={(e) => update({ name: e.target.value })}
            title={nameError}
            className={`bg-bg-elevated px-2 py-1 rounded w-full text-sm ${nameError ? 'ring-1 ring-error' : ''}`}
          />
          {nameError && <div className="text-error text-xs mt-1">{nameError}</div>}
        </td>
        <td className="px-3 py-2 w-[18%]">
          <input
            aria-label={`${entryKey} role`}
            value={person.role ?? ''}
            onChange={(e) => update({ role: e.target.value || undefined })}
            placeholder="CPO, EM, Designer…"
            className="bg-bg-elevated px-2 py-1 rounded w-full text-sm"
          />
        </td>
        <td className="px-3 py-2">
          <ChipsInput
            label={`${entryKey} teams`}
            values={person.teams ?? []}
            onChange={(v) => update({ teams: v.length ? v : undefined })}
            placeholder="Enter…"
            hideLabel
          />
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button
            type="button"
            onClick={onDelete}
            className="text-error hover:underline text-xs"
            aria-label={`delete ${entryKey}`}
          >
            Delete
          </button>
        </td>
      </tr>
      {showMore && (
        <tr className="border-b border-border bg-bg-secondary/30">
          <td />
          <td colSpan={4} className="px-3 py-3">
            <div className="grid grid-cols-2 gap-3 max-w-3xl">
              <ChipsInput
                label="aliases"
                values={person.aliases ?? []}
                onChange={(v) => update({ aliases: v.length ? v : undefined })}
              />
              <ChipsInput
                label="projects"
                values={person.projects ?? []}
                onChange={(v) => update({ projects: v.length ? v : undefined })}
              />
              <label className="flex flex-col gap-1 text-xs">
                slack_username
                <input
                  value={person.identifiers.slack_username ?? ''}
                  onChange={(e) => updateIdent({ slack_username: e.target.value || undefined })}
                  className="bg-bg-elevated px-2 py-1 rounded text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                email
                <input
                  value={person.identifiers.email ?? ''}
                  onChange={(e) => updateIdent({ email: e.target.value || undefined })}
                  title={emailError}
                  className={`bg-bg-elevated px-2 py-1 rounded text-sm ${emailError ? 'ring-1 ring-error' : ''}`}
                />
                {emailError && <span className="text-error text-xs">{emailError}</span>}
              </label>
              <label className="flex flex-col gap-1 text-xs">
                confluence_username
                <input
                  value={person.identifiers.confluence_username ?? ''}
                  onChange={(e) => updateIdent({ confluence_username: e.target.value || undefined })}
                  className="bg-bg-elevated px-2 py-1 rounded text-sm"
                />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
