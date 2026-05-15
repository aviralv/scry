import type { Registry, Person, Project } from '../config/types.js';

export interface DetectedEntities {
  people: Person[];
  projects: Project[];
}

export function detectEntities(query: string, registry: Registry): DetectedEntities {
  const words = query.toLowerCase();
  const people: Person[] = [];
  const projects: Project[] = [];

  for (const [key, person] of Object.entries(registry.people)) {
    const firstName = person.name.split(' ')[0].toLowerCase();
    const lastName = person.name.split(' ').slice(-1)[0].toLowerCase();
    if (
      words.includes(key.toLowerCase()) ||
      words.includes(firstName) ||
      words.includes(lastName) ||
      words.includes(person.name.toLowerCase())
    ) {
      people.push(person);
    }
  }

  for (const [key, project] of Object.entries(registry.projects)) {
    const nameTokens = [
      key.toLowerCase(),
      project.name.toLowerCase(),
      ...(project.aliases?.map(a => a.toLowerCase()) ?? []),
    ];
    if (nameTokens.some(token => words.includes(token))) {
      projects.push(project);
    }
  }

  return { people, projects };
}
