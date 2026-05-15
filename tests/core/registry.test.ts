import { describe, it, expect } from 'vitest';
import { loadRegistry, findPerson, findProject } from '../../src/core/registry.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(__dirname, '../fixtures/registry.yaml');

describe('loadRegistry', () => {
  it('loads registry from YAML file', () => {
    const registry = loadRegistry(registryPath);
    expect(Object.keys(registry.people)).toHaveLength(2);
    expect(Object.keys(registry.projects)).toHaveLength(2);
  });

  it('parses person identifiers correctly', () => {
    const registry = loadRegistry(registryPath);
    const marcus = registry.people['marcus-karlbowski'];
    expect(marcus.name).toBe('Marcus Karlbowski');
    expect(marcus.identifiers.email).toBe('marcus.karlbowski@sap.com');
  });

  it('parses project routing correctly', () => {
    const registry = loadRegistry(registryPath);
    const eca = registry.projects.eca;
    expect(eca.routing.slack_channels).toContain('team-nova-internal');
    expect(eca.routing.jira_project).toBe('ECA');
  });
});

describe('findPerson', () => {
  it('finds by full name (case-insensitive)', () => {
    const registry = loadRegistry(registryPath);
    const result = findPerson('marcus karlbowski', registry);
    expect(result?.name).toBe('Marcus Karlbowski');
  });

  it('finds by partial name', () => {
    const registry = loadRegistry(registryPath);
    const result = findPerson('Marcus', registry);
    expect(result?.name).toBe('Marcus Karlbowski');
  });

  it('finds by slug key', () => {
    const registry = loadRegistry(registryPath);
    const result = findPerson('dimitri-natusch', registry);
    expect(result?.name).toBe('Dimitri Natusch');
  });

  it('returns null for unknown person', () => {
    const registry = loadRegistry(registryPath);
    expect(findPerson('nobody', registry)).toBeNull();
  });
});

describe('findProject', () => {
  it('finds by name', () => {
    const registry = loadRegistry(registryPath);
    const result = findProject('ECA', registry);
    expect(result?.name).toBe('Enterprise Content Agent');
  });

  it('finds by alias', () => {
    const registry = loadRegistry(registryPath);
    const result = findProject('UDA', registry);
    expect(result?.name).toBe('Enterprise Content Agent');
  });

  it('finds by slug key', () => {
    const registry = loadRegistry(registryPath);
    const result = findProject('dq-2.0', registry);
    expect(result?.name).toBe('Data Quality 2.0');
  });

  it('returns null for unknown project', () => {
    const registry = loadRegistry(registryPath);
    expect(findProject('nonexistent', registry)).toBeNull();
  });
});
