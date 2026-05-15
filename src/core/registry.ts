import { readFileSync } from 'fs';
import { parse } from 'yaml';
import type { Registry, Person, Project } from '../config/types.js';

export function loadRegistry(path: string): Registry {
  const raw = readFileSync(path, 'utf-8');
  const parsed = parse(raw);
  return {
    people: parsed.people ?? {},
    projects: parsed.projects ?? {},
  };
}

export function findPerson(query: string, registry: Registry): Person | null {
  const q = query.toLowerCase();

  for (const [key, person] of Object.entries(registry.people)) {
    if (key.toLowerCase() === q) return person;
    if (person.name.toLowerCase() === q) return person;
    if (person.name.toLowerCase().includes(q)) return person;
  }
  return null;
}

export function findProject(query: string, registry: Registry): Project | null {
  const q = query.toLowerCase();

  for (const [key, project] of Object.entries(registry.projects)) {
    if (key.toLowerCase() === q) return project;
    if (project.name.toLowerCase() === q) return project;
    if (project.name.toLowerCase().includes(q)) return project;
    if (project.aliases?.some(a => a.toLowerCase() === q)) return project;
  }
  return null;
}
