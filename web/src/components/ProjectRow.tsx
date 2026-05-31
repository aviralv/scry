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

// Always-visible primary fields are name, aliases, routing.slack_channels, people.
// Anything else (routing.confluence_cql, routing.jira_project) opens "More fields".
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

  return (
    <div className="border-b border-border py-3 px-3" data-testid={`project-row-${entryKey}`}>
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
            value={project.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-bg-elevated px-2 py-1 rounded"
          />
          {getError(errors, 'name') && <span className="text-error text-xs">{getError(errors, 'name')}</span>}
        </label>
        <ChipsInput
          label="aliases"
          values={project.aliases ?? []}
          onChange={(v) => update({ aliases: v.length ? v : undefined })}
          placeholder="press Enter to add"
        />
        <ChipsInput
          label="slack_channels"
          values={project.routing?.slack_channels ?? []}
          onChange={(v) => updateRouting({ slack_channels: v.length ? v : undefined })}
          placeholder="#channel-name"
        />
        <ChipsInput
          label="people"
          values={project.people ?? []}
          onChange={(v) => update({ people: v.length ? v : undefined })}
          placeholder="press Enter to add"
        />

        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          aria-label={showMore ? 'hide more fields' : 'show more fields'}
          aria-expanded={showMore}
          className="self-start text-text-tertiary hover:text-text-primary text-xs mt-1"
        >
          {showMore ? '− Less' : '+ More fields (jira, confluence)'}
        </button>

        {showMore && (
          <div className="flex flex-col gap-2 pt-1">
            <fieldset className="flex flex-col gap-2 border border-border rounded p-2">
              <legend className="text-xs text-text-tertiary px-1">routing</legend>
              <label className="flex flex-col gap-1 text-xs">
                jira_project
                <input
                  value={project.routing?.jira_project ?? ''}
                  onChange={(e) => updateRouting({ jira_project: e.target.value || undefined })}
                  placeholder="EA"
                  className="bg-bg-elevated px-2 py-1 rounded font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                confluence_cql
                <input
                  value={project.routing?.confluence_cql ?? ''}
                  onChange={(e) => updateRouting({ confluence_cql: e.target.value || undefined })}
                  placeholder="space=EA AND label=design"
                  className="bg-bg-elevated px-2 py-1 rounded font-mono"
                />
              </label>
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}
