import { useState, useEffect, type JSX } from 'react';
import type { Project, ApiErrorIssue } from '@shared/types.js';
import { ChipsInput } from './ChipsInput.js';

interface Props {
  entryKey: string;
  project: Project;
  dirty: boolean;
  errors: ApiErrorIssue[];
  defaultExpanded?: boolean;
  onChange: (next: Project) => void;
  onDelete: () => void;
}

function getError(errors: ApiErrorIssue[], ...path: string[]): string | undefined {
  return errors.find((i) => path.every((seg, idx) => i.path[2 + idx] === seg))?.message;
}

function hasExtendedError(errors: ApiErrorIssue[]): boolean {
  return errors.some((i) => {
    const field = String(i.path[2] ?? '');
    if (field === 'name' || field === 'aliases' || field === 'people') return false;
    if (field === 'routing') {
      const sub = String(i.path[3] ?? '');
      return sub !== 'slack_channels';
    }
    return true;
  });
}

export function ProjectRow({ entryKey, project, dirty, errors, defaultExpanded, onChange, onDelete }: Props): JSX.Element {
  const [showMore, setShowMore] = useState(defaultExpanded === true || hasExtendedError(errors));

  useEffect(() => {
    if (hasExtendedError(errors)) setShowMore(true);
  }, [errors]);

  const update = (patch: Partial<Project>) => onChange({ ...project, ...patch });
  const updateRouting = (patch: Partial<Project['routing']>) =>
    onChange({ ...project, routing: { ...project.routing, ...patch } });

  const nameError = getError(errors, 'name');

  return (
    <>
      <tr className="border-b border-border align-top" data-testid={`project-row-${entryKey}`}>
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
        <td className="px-3 py-2 w-[20%]">
          <input
            aria-label={`${entryKey} name`}
            value={project.name}
            onChange={(e) => update({ name: e.target.value })}
            title={nameError}
            className={`bg-bg-elevated px-2 py-1 rounded w-full text-sm ${nameError ? 'ring-1 ring-error' : ''}`}
          />
          {nameError && <div className="text-error text-xs mt-1">{nameError}</div>}
        </td>
        <td className="px-3 py-2 w-[18%]">
          <ChipsInput
            label={`${entryKey} aliases`}
            values={project.aliases ?? []}
            onChange={(v) => update({ aliases: v.length ? v : undefined })}
            placeholder="Enter…"
          />
        </td>
        <td className="px-3 py-2 w-[22%]">
          <ChipsInput
            label={`${entryKey} slack_channels`}
            values={project.routing?.slack_channels ?? []}
            onChange={(v) => updateRouting({ slack_channels: v.length ? v : undefined })}
            placeholder="#channel"
          />
        </td>
        <td className="px-3 py-2">
          <ChipsInput
            label={`${entryKey} people`}
            values={project.people ?? []}
            onChange={(v) => update({ people: v.length ? v : undefined })}
            placeholder="Enter…"
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
          <td colSpan={5} className="px-3 py-3">
            <div className="grid grid-cols-2 gap-3 max-w-3xl">
              <label className="flex flex-col gap-1 text-xs">
                jira_project
                <input
                  value={project.routing?.jira_project ?? ''}
                  onChange={(e) => updateRouting({ jira_project: e.target.value || undefined })}
                  placeholder="EA"
                  className="bg-bg-elevated px-2 py-1 rounded text-sm font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                confluence_cql
                <input
                  value={project.routing?.confluence_cql ?? ''}
                  onChange={(e) => updateRouting({ confluence_cql: e.target.value || undefined })}
                  placeholder="space=EA AND label=design"
                  className="bg-bg-elevated px-2 py-1 rounded text-sm font-mono"
                />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
