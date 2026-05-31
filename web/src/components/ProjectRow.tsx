import { useState, type JSX } from 'react';
import type { Project, ApiErrorIssue } from '@shared/types.js';
import { ChipsInput } from './ChipsInput.js';

interface Props {
  entryKey: string;
  project: Project;
  dirty: boolean;
  errors: ApiErrorIssue[];
  onChange: (next: Project) => void;
  onDelete: () => void;
}

function getError(errors: ApiErrorIssue[], ...path: string[]): string | undefined {
  return errors.find((i) => path.every((seg, idx) => i.path[2 + idx] === seg))?.message;
}

export function ProjectRow({ entryKey, project, dirty, errors, onChange, onDelete }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(errors.length > 0);

  const update = (patch: Partial<Project>) => onChange({ ...project, ...patch });
  const updateRouting = (patch: Partial<Project['routing']>) =>
    onChange({ ...project, routing: { ...project.routing, ...patch } });

  const summary = [
    (project.routing?.slack_channels ?? []).join(' '),
    project.routing?.jira_project,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border-b border-border" data-testid={`project-row-${entryKey}`}>
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
        <span className="text-text-primary text-sm flex-1">{project.name}</span>
        {summary && <span className="text-text-tertiary text-xs font-mono">{summary}</span>}
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

      {expanded && (
        <div className="px-3 pb-3 pl-12 flex flex-col gap-2 bg-bg-secondary/30">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={project.name}
              onChange={(e) => update({ name: e.target.value })}
              className="bg-bg-elevated px-2 py-1 rounded"
            />
            {getError(errors, 'name') && <span className="text-error text-xs">{getError(errors, 'name')}</span>}
          </label>
          <ChipsInput label="aliases" values={project.aliases ?? []} onChange={(v) => update({ aliases: v.length ? v : undefined })} />

          <fieldset className="flex flex-col gap-2 border border-border rounded p-2">
            <legend className="text-xs text-text-tertiary px-1">routing</legend>
            <ChipsInput
              label="slack_channels"
              values={project.routing?.slack_channels ?? []}
              onChange={(v) => updateRouting({ slack_channels: v.length ? v : undefined })}
            />
            <label className="flex flex-col gap-1 text-xs">
              confluence_cql
              <input
                value={project.routing?.confluence_cql ?? ''}
                onChange={(e) => updateRouting({ confluence_cql: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded font-mono"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              jira_project
              <input
                value={project.routing?.jira_project ?? ''}
                onChange={(e) => updateRouting({ jira_project: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded font-mono"
              />
            </label>
          </fieldset>

          <ChipsInput label="people" values={project.people ?? []} onChange={(v) => update({ people: v.length ? v : undefined })} />
        </div>
      )}
    </div>
  );
}
