import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/engine/system-prompt.js';
import type { Registry } from '../../src/config/types.js';

const empty: Registry = { people: {}, projects: {} };

describe('buildSystemPrompt', () => {
  it('always includes scry identity and citation rules', () => {
    const p = buildSystemPrompt({ registry: empty, fanoutMode: false });
    expect(p).toMatch(/scry/i);
    expect(p).toMatch(/\[1\]/);
    expect(p).toMatch(/cite/i);
  });

  it('includes registry as JSON when populated', () => {
    const registry: Registry = {
      people: { aviralv: { name: 'Aviral Vaid', identifiers: { email: 'av@example.com' } } },
      projects: { eca: { name: 'ECA', aliases: ['eca-platform'], routing: { slack_channels: ['team-eca'] } } },
    };
    const p = buildSystemPrompt({ registry, fanoutMode: false });
    expect(p).toContain('Aviral Vaid');
    expect(p).toContain('ECA');
    expect(p).toContain('team-eca');
  });

  it('adds fanout directive when fanoutMode is true', () => {
    const p = buildSystemPrompt({ registry: empty, fanoutMode: true });
    expect(p).toMatch(/all.*configured.*tools|every.*search.*source|exhaustive|fanout/i);
  });

  it('omits fanout directive when fanoutMode is false', () => {
    const p = buildSystemPrompt({ registry: empty, fanoutMode: false });
    expect(p).not.toMatch(/fanout mode/i);
  });
});
