import { useState, useEffect, useCallback, useMemo, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiCallError } from '../lib/api.js';
import { getRegistry, putRegistry } from '../lib/registry.js';
import type { Registry as RegistryT, Person, Project, ApiErrorIssue } from '@shared/types.js';
import { PersonRow } from '../components/PersonRow.js';
import { ProjectRow } from '../components/ProjectRow.js';
import { AddRegistryEntryModal } from '../components/AddRegistryEntryModal.js';

type Tab = 'people' | 'projects';

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function computeDirty(server: RegistryT, working: RegistryT): Set<string> {
  const dirty = new Set<string>();
  for (const k of new Set([...Object.keys(server.people), ...Object.keys(working.people)])) {
    if (!deepEqual(server.people[k], working.people[k])) dirty.add(`people:${k}`);
  }
  for (const k of new Set([...Object.keys(server.projects), ...Object.keys(working.projects)])) {
    if (!deepEqual(server.projects[k], working.projects[k])) dirty.add(`projects:${k}`);
  }
  return dirty;
}

export function Registry(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'projects' ? 'projects' : 'people';

  const [server, setServer] = useState<RegistryT | null>(null);
  const [working, setWorking] = useState<RegistryT | null>(null);
  const [needsConfig, setNeedsConfig] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<ApiErrorIssue[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<null | Tab>(null);
  // Keys (e.g. 'people:jens-r') that should mount expanded — used so newly-added
  // rows immediately reveal their email/aliases/teams fields rather than
  // collapsing back to the summary view.
  const [autoExpand, setAutoExpand] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const reg = await getRegistry();
      setServer(reg);
      setWorking(reg);
      setNeedsConfig(false);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 412) {
        setNeedsConfig(true);
      } else {
        setLoadError((err as Error).message ?? 'failed to load');
      }
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const dirty = useMemo(() => {
    if (!server || !working) return new Set<string>();
    return computeDirty(server, working);
  }, [server, working]);

  const setTab = (t: Tab) => setSearchParams((sp) => {
    sp.set('tab', t);
    return sp;
  });

  const updatePerson = (key: string, next: Person) => {
    setWorking((w) => w ? { ...w, people: { ...w.people, [key]: next } } : w);
  };
  const updateProject = (key: string, next: Project) => {
    setWorking((w) => w ? { ...w, projects: { ...w.projects, [key]: next } } : w);
  };
  const deletePerson = (key: string) => {
    setWorking((w) => {
      if (!w) return w;
      const people = { ...w.people };
      delete people[key];
      return { ...w, people };
    });
  };
  const deleteProject = (key: string) => {
    setWorking((w) => {
      if (!w) return w;
      const projects = { ...w.projects };
      delete projects[key];
      return { ...w, projects };
    });
  };

  const handleAdd = ({ key, name }: { key: string; name: string }) => {
    if (!modal || !working) return;
    if (modal === 'people') {
      setWorking({ ...working, people: { ...working.people, [key]: { name, identifiers: {} } } });
    } else {
      setWorking({ ...working, projects: { ...working.projects, [key]: { name, routing: {} } } });
    }
    setAutoExpand((prev) => new Set(prev).add(`${modal}:${key}`));
  };

  const handleSave = async () => {
    if (!working) return;
    setSaving(true);
    setSaveErrors(null);
    setLoadError(null);
    try {
      const saved = await putRegistry(working);
      setServer(saved);
      setWorking(saved);
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 400 && err.body.errors) {
        setSaveErrors(err.body.errors);
      } else {
        setLoadError((err as Error).message ?? 'save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (dirty.size > 0 && !window.confirm(`Discard ${dirty.size} change${dirty.size === 1 ? '' : 's'}?`)) return;
    if (server) setWorking(server);
    setSaveErrors(null);
  };

  if (needsConfig) {
    return (
      <div className="p-6 text-text-tertiary">
        No config yet. Run scry through onboarding first.
      </div>
    );
  }

  if (!working) {
    return <div className="p-6 text-text-tertiary">{loadError ?? 'Loading…'}</div>;
  }

  const errorsForKey = (group: Tab, key: string): ApiErrorIssue[] =>
    (saveErrors ?? []).filter((i) => i.path[0] === group && i.path[1] === key);

  const peopleKeys = Object.keys(working.people).sort();
  const projectKeys = Object.keys(working.projects).sort();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-text-primary text-xl">Registry</h1>
        <div className="flex items-center gap-2">
          {dirty.size > 0 && <span aria-label="dirty" className="text-text-tertiary text-xs">{dirty.size} unsaved change{dirty.size === 1 ? '' : 's'}</span>}
          <button
            type="button"
            onClick={handleDiscard}
            disabled={dirty.size === 0 || saving}
            className="px-3 py-1 text-text-tertiary text-sm disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={dirty.size === 0 || saving}
            className="px-3 py-1 bg-accent text-bg-primary rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="text-text-tertiary text-xs mb-3">
        Comments inside the registry block will be deleted on save. Edit scry.config.yaml directly if you want them preserved.
      </div>

      {loadError && <div className="text-error text-sm mb-3">{loadError}</div>}
      {saveErrors && <div className="text-error text-sm mb-3">Validation failed — fix the highlighted fields below.</div>}

      <div className="flex border-b border-border mb-3">
        <button
          type="button"
          onClick={() => setTab('people')}
          className={`px-4 py-2 text-sm ${tab === 'people' ? 'text-text-primary border-b-2 border-accent' : 'text-text-tertiary'}`}
        >
          People ({peopleKeys.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('projects')}
          className={`px-4 py-2 text-sm ${tab === 'projects' ? 'text-text-primary border-b-2 border-accent' : 'text-text-tertiary'}`}
        >
          Projects ({projectKeys.length})
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setModal(tab)}
          className="px-3 py-1 my-1 mr-1 bg-accent text-bg-primary rounded text-sm"
        >
          + Add {tab === 'people' ? 'Person' : 'Project'}
        </button>
      </div>

      {tab === 'people' ? (
        peopleKeys.length === 0 ? (
          <div className="p-4 text-text-tertiary italic text-sm">No people yet.</div>
        ) : (
          <table className="w-full table-fixed">
            <thead className="text-text-tertiary text-xs">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-normal w-44">key</th>
                <th className="px-3 py-2 text-left font-normal">Name</th>
                <th className="px-3 py-2 text-left font-normal">Role</th>
                <th className="px-3 py-2 text-left font-normal">Teams</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {peopleKeys.map((k) => (
                <PersonRow
                  key={k}
                  entryKey={k}
                  person={working.people[k]}
                  dirty={dirty.has(`people:${k}`)}
                  errors={errorsForKey('people', k)}
                  defaultExpanded={autoExpand.has(`people:${k}`)}
                  onChange={(next) => updatePerson(k, next)}
                  onDelete={() => {
                    if (window.confirm(`Delete person "${k}"?`)) deletePerson(k);
                  }}
                />
              ))}
            </tbody>
          </table>
        )
      ) : (
        projectKeys.length === 0 ? (
          <div className="p-4 text-text-tertiary italic text-sm">No projects yet.</div>
        ) : (
          <table className="w-full table-fixed">
            <thead className="text-text-tertiary text-xs">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-normal w-44">key</th>
                <th className="px-3 py-2 text-left font-normal">Name</th>
                <th className="px-3 py-2 text-left font-normal">Aliases</th>
                <th className="px-3 py-2 text-left font-normal">Slack channels</th>
                <th className="px-3 py-2 text-left font-normal">People</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {projectKeys.map((k) => (
                <ProjectRow
                  key={k}
                  entryKey={k}
                  project={working.projects[k]}
                  dirty={dirty.has(`projects:${k}`)}
                  errors={errorsForKey('projects', k)}
                  defaultExpanded={autoExpand.has(`projects:${k}`)}
                  onChange={(next) => updateProject(k, next)}
                  onDelete={() => {
                    if (window.confirm(`Delete project "${k}"?`)) deleteProject(k);
                  }}
                />
              ))}
            </tbody>
          </table>
        )
      )}

      {modal && (
        <AddRegistryEntryModal
          group={modal}
          existingKeys={modal === 'people' ? peopleKeys : projectKeys}
          onConfirm={handleAdd}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
