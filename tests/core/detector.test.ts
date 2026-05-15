import { describe, it, expect } from 'vitest';
import { detectEntities } from '../../src/core/detector.js';
import { loadRegistry } from '../../src/core/registry.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = loadRegistry(resolve(__dirname, '../fixtures/registry.yaml'));

describe('detectEntities', () => {
  it('detects project by name', () => {
    const result = detectEntities('what did we decide about ECA pricing?', registry);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('Enterprise Content Agent');
  });

  it('detects project by alias', () => {
    const result = detectEntities('latest UDA updates', registry);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('Enterprise Content Agent');
  });

  it('detects person by name', () => {
    const result = detectEntities('Marcus updates this week', registry);
    expect(result.people).toHaveLength(1);
    expect(result.people[0].name).toBe('Marcus Karlbowski');
  });

  it('detects multiple entities', () => {
    const result = detectEntities('Dimitri ECA discussion', registry);
    expect(result.people).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
  });

  it('returns empty when no entities match', () => {
    const result = detectEntities('general question about nothing', registry);
    expect(result.people).toHaveLength(0);
    expect(result.projects).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const result = detectEntities('eca pricing', registry);
    expect(result.projects).toHaveLength(1);
  });
});
