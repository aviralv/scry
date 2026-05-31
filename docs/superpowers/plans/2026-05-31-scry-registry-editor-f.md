# Plan F — Registry editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/registry` browser surface that edits the People + Projects sections of `~/.config/scry/scry.config.yaml` via a working-copy / Save / Discard pattern, backed by `writeConfig` and the `RegistrySchema` already shipped in Plan E.

**Architecture:** One Hono route (`/api/registry`, GET + PUT) that consumes `RegistrySchema` and writes through the existing `writeConfig` helper. One React route (`/registry`) with two tabs (People / Projects), inline expand-to-edit rows, generic `ChipsInput`, a shared add-entry modal, and a working-copy state machine that batches changes into a single PUT.

**Tech Stack:** TypeScript strict, Hono, zod v4, React 18 + react-router-dom v6, Tailwind, vitest + @testing-library/react. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-31-scry-registry-editor-f-design.md`](../specs/2026-05-31-scry-registry-editor-f-design.md). All shared infra (`writeConfig`, `RegistrySchema`, `PersonSchema`, `ProjectSchema`, `ApiErrorBody`, `react-router-dom`, `web/vitest.config.ts`) already shipped in Plan E (PR #12, merged).

---

## File map

**New (server):**
- `src/server/routes/registry.ts` — GET + PUT handlers, depends on `writeConfig` and `RegistrySchema`.
- `src/server/routes/registry.test.ts` — happy + 412 + 400 + golden comment-preservation.
- `src/server/routes/registry.csrf.test.ts` — per-route CSRF rejection on PUT.

**New (web):**
- `web/src/routes/Registry.tsx` — page with tabs + working-copy state + Save / Discard.
- `web/src/routes/Registry.test.tsx`
- `web/src/components/PersonRow.tsx`
- `web/src/components/ProjectRow.tsx`
- `web/src/components/ChipsInput.tsx`
- `web/src/components/ChipsInput.test.tsx`
- `web/src/components/AddRegistryEntryModal.tsx`
- `web/src/components/AddRegistryEntryModal.test.tsx`
- `web/src/lib/registry.ts` — typed API client.
- `web/src/lib/registry.test.ts`

**Modified:**
- `src/server/index.ts` — mount `/api/registry`.
- `web/src/App.tsx` — add `<Route path="/registry" ...>`.
- `web/src/components/LibrarySidebar.tsx` — add the third `NavLink` ("Registry").

**No new dependencies.** `react-router-dom`, `proper-lockfile`, zod, yaml, jsdom, @testing-library/react all installed by Plan E.

## Sequencing rationale

T1 lands the server route, which is the smallest unit that produces working software (testable via curl). T2 wires it into the live server + sidebar nav so smoke testing works. T3–T5 build the leaf web pieces (typed client, ChipsInput, modal). T6 + T7 build PersonRow and ProjectRow. T8 integrates everything in `Registry.tsx` with the working-copy state machine — the last and biggest task. T9 adds the CSRF rejection test and pauses for manual smoke before the PR is opened.

Each task ends with a commit. Every task's commit leaves the tree green (build clean, tests pass).

---

## Task 1: `/api/registry` server route

**Files:**
- Create: `src/server/routes/registry.ts`
- Test: `src/server/routes/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/routes/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildRegistryRoute } from './registry.js';

let dir: string;
let cfg: string;
let app: Hono;

const SEED_NO_REGISTRY = `# top comment
llm: {}
mcp_servers: {}
search_tools: {}
# bottom comment
`;

const SEED_WITH_REGISTRY = `llm: {}
mcp_servers: {}
search_tools: {}
registry:
  people:
    andre:
      name: Andre Christ
      identifiers:
        slack_username: andre
  projects:
    ea:
      name: Enterprise Architecture
      routing:
        slack_channels:
          - "#ea"
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-registry-route-'));
  cfg = join(dir, 'scry.config.yaml');
  app = new Hono();
  app.route('/api/registry', buildRegistryRoute({ configPath: () => cfg }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const csrfHeaders = { 'Content-Type': 'application/json', 'X-Scry-Csrf': 'test' };

describe('GET /api/registry', () => {
  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/registry');
    expect(r.status).toBe(412);
    const body = await r.json();
    expect(body.error).toBe('config-required');
  });

  it('returns empty registry when config has no registry block', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry).toEqual({ people: {}, projects: {} });
  });

  it('returns existing registry shape', async () => {
    writeFileSync(cfg, SEED_WITH_REGISTRY);
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry.people.andre.name).toBe('Andre Christ');
    expect(body.registry.projects.ea.routing.slack_channels).toEqual(['#ea']);
  });
});

describe('PUT /api/registry', () => {
  it('returns 412 when config does not exist', async () => {
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: { people: {}, projects: {} } }),
    });
    expect(r.status).toBe(412);
  });

  it('writes the registry and returns 200 with the saved registry', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const next = {
      people: { 'jens-r': { name: 'Jens', identifiers: {} } },
      projects: {},
    };
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: next }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.registry.people['jens-r'].name).toBe('Jens');
    expect(readFileSync(cfg, 'utf-8')).toContain('jens-r');
  });

  it('returns 400 with path-scoped errors on invalid registry', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const bad = {
      people: { 'BAD KEY': { name: 'X', identifiers: {} } },
      projects: {},
    };
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: bad }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('invalid-body');
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toHaveProperty('path');
  });

  it('returns 400 on missing registry field in body', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders, body: '{}',
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 on malformed JSON', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders, body: 'not-json',
    });
    expect(r.status).toBe(400);
  });

  it('preserves comments outside the registry block (golden test)', async () => {
    writeFileSync(cfg, SEED_NO_REGISTRY);
    const next = { people: { x: { name: 'X', identifiers: {} } }, projects: {} };
    await app.request('/api/registry', {
      method: 'PUT', headers: csrfHeaders,
      body: JSON.stringify({ registry: next }),
    });
    const raw = readFileSync(cfg, 'utf-8');
    expect(raw).toContain('# top comment');
    expect(raw).toContain('# bottom comment');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/I578221/Library/CloudStorage/OneDrive-SAPSE/Documents/the-product-kitchen/Playground/scry
npx vitest run src/server/routes/registry.test.ts
```

Expected: FAIL — module `./registry.js` not found.

- [ ] **Step 3: Implement `src/server/routes/registry.ts`**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { RegistrySchema } from '../../config/schema.js';
import { writeConfig, ConfigValidationError } from '../../config/write-config.js';
import { zodToApiErrors } from '../../shared/api-errors.js';
import type { Registry } from '../../config/types.js';

const PutBodySchema = z.object({
  registry: RegistrySchema,
});

interface RouteDeps {
  configPath: () => string;
}

const EMPTY_REGISTRY: Registry = { people: {}, projects: {} };

function loadRegistry(configPath: string): Registry | null {
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw) as { registry?: Registry } | undefined;
  return parsed?.registry ?? EMPTY_REGISTRY;
}

export function buildRegistryRoute(deps: RouteDeps): Hono {
  return new Hono()
    .get('/', (c) => {
      const reg = loadRegistry(deps.configPath());
      if (reg === null) return c.json({ error: 'config-required', message: 'scry.config.yaml does not exist' }, 412);
      return c.json({ registry: reg });
    })
    .put('/', async (c) => {
      const cfgPath = deps.configPath();
      if (!existsSync(cfgPath)) return c.json({ error: 'config-required' }, 412);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'invalid-body', message: 'malformed JSON' }, 400);
      }
      const parsed = PutBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: 'invalid-body', errors: zodToApiErrors(parsed.error.issues) }, 400);
      }

      try {
        await writeConfig(cfgPath, { registry: parsed.data.registry });
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return c.json({ error: 'invalid-body', errors: err.issues }, 400);
        }
        throw err;
      }
      return c.json({ registry: parsed.data.registry });
    });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/server/routes/registry.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/registry.ts src/server/routes/registry.test.ts
git commit -m "feat(server): /api/registry route (GET + PUT) with path-scoped errors"
```

---

## Task 2: Mount `/api/registry` and add Registry nav link

**Files:**
- Modify: `src/server/index.ts`
- Modify: `web/src/App.tsx` (add `/registry` route with stub)
- Modify: `web/src/components/LibrarySidebar.tsx` (add third NavLink)
- Create: `web/src/routes/Registry.tsx` (stub, replaced in T8)

- [ ] **Step 1: Mount the route in `src/server/index.ts`**

Read the current `src/server/index.ts`. Find the line:

```typescript
  app.route('/api/mcps', buildMcpsRoute({ configPath: () => resolveConfigPath() }));
```

Add a sibling line immediately below it:

```typescript
  app.route('/api/registry', buildRegistryRoute({ configPath: () => resolveConfigPath() }));
```

Add the matching import near the other route imports:

```typescript
import { buildRegistryRoute } from './routes/registry.js';
```

- [ ] **Step 2: Stub `web/src/routes/Registry.tsx`**

Create the file:

```tsx
import type { JSX } from 'react';
export function Registry(): JSX.Element {
  return <div className="p-6 text-text-tertiary">Registry editor — coming next task.</div>;
}
```

- [ ] **Step 3: Add `/registry` route in `web/src/App.tsx`**

Read the current `web/src/App.tsx`. Find the line:

```tsx
          <Route path="/mcps" element={<McpManager />} />
```

Add a sibling line immediately below it:

```tsx
          <Route path="/registry" element={<Registry />} />
```

Add the matching import near the existing route imports:

```tsx
import { Registry } from './routes/Registry.js';
```

- [ ] **Step 4: Add `Registry` NavLink to `web/src/components/LibrarySidebar.tsx`**

Read the current `web/src/components/LibrarySidebar.tsx`. Find the `<NavLink to="/mcps" ...>MCPs</NavLink>` block. Add a third `NavLink` right after it, inside the same nav `<div>`:

```tsx
        <NavLink
          to="/registry"
          className={({ isActive }: { isActive: boolean }) =>
            `px-2 py-1 rounded ${isActive ? 'bg-bg-elevated text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`
          }
        >
          Registry
        </NavLink>
```

- [ ] **Step 5: Confirm build**

```bash
cd /Users/I578221/Library/CloudStorage/OneDrive-SAPSE/Documents/the-product-kitchen/Playground/scry
cd web && npm run build && cd ..
npx tsc --noEmit
```

Expected: web build clean, server tsc clean.

- [ ] **Step 6: Smoke server route**

The server tests at T1 already cover the route in isolation. As an extra integration check, run the full server suite:

```bash
npx vitest run
```

Expected: all server tests pass; the new mount doesn't regress anything.

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts web/src/App.tsx web/src/routes/Registry.tsx web/src/components/LibrarySidebar.tsx
git commit -m "feat(server,web): mount /api/registry + Registry nav link + stub route"
```

---

## Task 3: Typed API client `web/src/lib/registry.ts`

**Files:**
- Create: `web/src/lib/registry.ts`
- Test: `web/src/lib/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/registry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as registry from './registry.js';
import { ApiCallError } from './api.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  document.head.innerHTML = '<meta name="scry-csrf" content="test-token">';
});

describe('getRegistry', () => {
  it('returns the registry object', async () => {
    const reg = { people: {}, projects: {} };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ registry: reg }), { status: 200 }));
    const r = await registry.getRegistry();
    expect(r).toEqual(reg);
  });

  it('throws ApiCallError with status 412 on missing config', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'config-required' }), { status: 412 }));
    let caught: unknown;
    try { await registry.getRegistry(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiCallError);
    expect((caught as ApiCallError).status).toBe(412);
  });
});

describe('putRegistry', () => {
  it('PUTs the registry and returns the saved value', async () => {
    const reg = { people: { x: { name: 'X', identifiers: {} } }, projects: {} };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ registry: reg }), { status: 200 }));
    const r = await registry.putRegistry(reg);
    expect(r.people.x.name).toBe('X');
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('PUT');
    expect(call[1].headers.get('X-Scry-Csrf')).toBe('test-token');
  });

  it('throws ApiCallError with body.errors populated on 400', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: 'invalid-body', errors: [{ path: ['people', 'BAD KEY'], message: 'Invalid' }] }),
      { status: 400 },
    ));
    let caught: unknown;
    try { await registry.putRegistry({ people: {}, projects: {} }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiCallError);
    expect((caught as ApiCallError).body.errors).toEqual([{ path: ['people', 'BAD KEY'], message: 'Invalid' }]);
  });
});
```

- [ ] **Step 2: Run test (will fail)**

```bash
cd web && npx vitest run src/lib/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/registry.ts`**

```typescript
import { apiJson } from './api.js';
import type { Registry } from '@shared/types.js';

export async function getRegistry(): Promise<Registry> {
  const r = await apiJson<{ registry: Registry }>('/api/registry');
  return r.registry;
}

export async function putRegistry(registry: Registry): Promise<Registry> {
  const r = await apiJson<{ registry: Registry }>('/api/registry', {
    method: 'PUT',
    body: JSON.stringify({ registry }),
  });
  return r.registry;
}
```

The `Registry` type re-export must exist. If `@shared/types.js` does not currently re-export it, add the line `export type { Registry } from '../config/types.js';` to `src/shared/types.ts` first. (Plan E added several re-exports; check before writing.)

- [ ] **Step 4: Verify the re-export exists**

```bash
grep -n "Registry" src/shared/types.ts
```

If `Registry` is NOT exported from `src/shared/types.ts`, add it:

```typescript
export type { Registry, Person, Project } from '../config/types.js';
```

- [ ] **Step 5: Run tests**

```bash
cd web && npx vitest run src/lib/registry.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/registry.ts web/src/lib/registry.test.ts src/shared/types.ts
git commit -m "feat(web): typed API client for /api/registry"
```

---

## Task 4: `ChipsInput` generic component

**Files:**
- Create: `web/src/components/ChipsInput.tsx`
- Test: `web/src/components/ChipsInput.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ChipsInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChipsInput } from './ChipsInput.js';

describe('ChipsInput', () => {
  it('renders existing chips', () => {
    render(<ChipsInput label="teams" values={['eng', 'pm']} onChange={() => {}} />);
    expect(screen.getByText('eng')).toBeInTheDocument();
    expect(screen.getByText('pm')).toBeInTheDocument();
  });

  it('adds a chip on Enter', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'design' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['eng', 'design']);
  });

  it('adds a chip on comma', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'eng' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['eng']);
  });

  it('removes the last chip on Backspace when input is empty', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng', 'pm']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['eng']);
  });

  it('does NOT remove chips on Backspace when input has text', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'd' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a chip when its × button is clicked', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng', 'pm']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove eng/i }));
    expect(onChange).toHaveBeenCalledWith(['pm']);
  });

  it('trims whitespace and ignores empty input on Enter', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not add a duplicate chip', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'eng' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables input and chip-remove buttons when disabled prop is true', () => {
    render(<ChipsInput label="teams" values={['eng']} onChange={() => {}} disabled />);
    expect(screen.getByLabelText(/teams/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove eng/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test (will fail)**

```bash
cd web && npx vitest run src/components/ChipsInput.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/ChipsInput.tsx`**

```tsx
import { useState, useId, type JSX, type KeyboardEvent } from 'react';

interface Props {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChipsInput({ label, values, onChange, placeholder, disabled }: Props): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  };

  const removeAt = (i: number) => {
    onChange(values.filter((_, j) => j !== i));
  };

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-text-tertiary text-xs">{label}</label>
      <div className="flex flex-wrap gap-1 items-center bg-bg-elevated px-2 py-1 rounded">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="bg-bg-secondary text-text-primary px-2 py-0.5 rounded text-xs flex items-center gap-1">
            {v}
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={disabled}
              aria-label={`remove ${v}`}
              className="text-text-tertiary hover:text-text-primary disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled}
          placeholder={placeholder}
          className="bg-transparent outline-none flex-1 min-w-[80px] text-sm disabled:opacity-50"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/ChipsInput.test.tsx
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChipsInput.tsx web/src/components/ChipsInput.test.tsx
git commit -m "feat(web): generic ChipsInput component"
```

---

## Task 5: `AddRegistryEntryModal` component

**Files:**
- Create: `web/src/components/AddRegistryEntryModal.tsx`
- Test: `web/src/components/AddRegistryEntryModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/AddRegistryEntryModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddRegistryEntryModal } from './AddRegistryEntryModal.js';

describe('AddRegistryEntryModal', () => {
  it('renders fields for a Person', () => {
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/add person/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it('renders fields for a Project', () => {
    render(<AddRegistryEntryModal group="projects" existingKeys={[]} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/add project/i)).toBeInTheDocument();
  });

  it('rejects malformed slug key', () => {
    const onConfirm = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'BAD KEY' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Some Name' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByText(/lowercase|slug|invalid key/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects duplicate key', () => {
    const onConfirm = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={['andre']} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'andre' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByText(/already exists|duplicate/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects empty name', () => {
    const onConfirm = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'jens' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the typed group on valid submit', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'jens-r' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Jens R' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onConfirm).toHaveBeenCalledWith({ key: 'jens-r', name: 'Jens R' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel closes without confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test (will fail)**

```bash
cd web && npx vitest run src/components/AddRegistryEntryModal.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/AddRegistryEntryModal.tsx`**

```tsx
import { useState, type JSX, type FormEvent } from 'react';

const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;

interface Props {
  group: 'people' | 'projects';
  existingKeys: string[];
  onConfirm: (entry: { key: string; name: string }) => void;
  onClose: () => void;
}

export function AddRegistryEntryModal({ group, existingKeys, onConfirm, onClose }: Props): JSX.Element {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const title = group === 'people' ? 'Add Person' : 'Add Project';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!SLUG_RE.test(key)) {
      setError('Key must be a lowercase slug (letters, digits, _, -; starts with a letter)');
      return;
    }
    if (existingKeys.includes(key)) {
      setError(`Key "${key}" already exists in ${group}`);
      return;
    }
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    onConfirm({ key, name: name.trim() });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-bg-secondary p-6 rounded w-[420px] flex flex-col gap-3">
        <h2 className="text-text-primary text-lg">{title}</h2>

        <label className="flex flex-col gap-1 text-sm">
          Key (slug)
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            placeholder="andre-c"
            className="bg-bg-elevated px-2 py-1 rounded font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Andre Christ"
            className="bg-bg-elevated px-2 py-1 rounded"
          />
        </label>

        {error && <div role="alert" className="text-error text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-text-tertiary">Cancel</button>
          <button type="submit" className="px-3 py-1 bg-accent text-bg-primary rounded">Add</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/AddRegistryEntryModal.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AddRegistryEntryModal.tsx web/src/components/AddRegistryEntryModal.test.tsx
git commit -m "feat(web): AddRegistryEntryModal (slug + name, group-aware)"
```

---

## Task 6: `PersonRow` component

**Files:**
- Create: `web/src/components/PersonRow.tsx`

(Tested via `Registry.test.tsx` in T8 — render-and-bind component.)

- [ ] **Step 1: Implement `web/src/components/PersonRow.tsx`**

```tsx
import { useState, type JSX } from 'react';
import type { Person } from '@shared/types.js';
import type { ApiErrorIssue } from '@shared/types.js';
import { ChipsInput } from './ChipsInput.js';

interface Props {
  entryKey: string;
  person: Person;
  dirty: boolean;
  errors: ApiErrorIssue[];
  onChange: (next: Person) => void;
  onDelete: () => void;
}

function getError(errors: ApiErrorIssue[], ...path: string[]): string | undefined {
  // Match issues whose path starts with the given suffix relative to the row.
  // Row's path prefix is ["people", entryKey, ...path]; issues already filtered
  // by row, so issue.path[2..] should match the suffix.
  return errors.find((i) => path.every((seg, idx) => i.path[2 + idx] === seg))?.message;
}

export function PersonRow({ entryKey, person, dirty, errors, onChange, onDelete }: Props): JSX.Element {
  // Auto-expand when there are errors so the user can see the offending field.
  const [expanded, setExpanded] = useState(errors.length > 0);

  const update = (patch: Partial<Person>) => onChange({ ...person, ...patch });
  const updateIdent = (patch: Partial<Person['identifiers']>) =>
    onChange({ ...person, identifiers: { ...person.identifiers, ...patch } });

  const summary = [person.role, (person.teams ?? []).join('/')].filter(Boolean).join(' · ');

  return (
    <div className="border-b border-border" data-testid={`person-row-${entryKey}`}>
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
        <span className="text-text-primary text-sm flex-1">{person.name}</span>
        {summary && <span className="text-text-tertiary text-xs">{summary}</span>}
        {dirty && <span aria-label="dirty" className="w-2 h-2 bg-accent rounded-full" />}
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
              value={person.name}
              onChange={(e) => update({ name: e.target.value })}
              className="bg-bg-elevated px-2 py-1 rounded"
            />
            {getError(errors, 'name') && <span className="text-error text-xs">{getError(errors, 'name')}</span>}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <input
              value={person.role ?? ''}
              onChange={(e) => update({ role: e.target.value || undefined })}
              className="bg-bg-elevated px-2 py-1 rounded"
            />
          </label>
          <ChipsInput label="teams" values={person.teams ?? []} onChange={(v) => update({ teams: v.length ? v : undefined })} />
          <ChipsInput label="aliases" values={person.aliases ?? []} onChange={(v) => update({ aliases: v.length ? v : undefined })} />
          <ChipsInput label="projects" values={person.projects ?? []} onChange={(v) => update({ projects: v.length ? v : undefined })} />

          <fieldset className="flex flex-col gap-2 border border-border rounded p-2">
            <legend className="text-xs text-text-tertiary px-1">identifiers</legend>
            <label className="flex flex-col gap-1 text-xs">
              slack_username
              <input
                value={person.identifiers.slack_username ?? ''}
                onChange={(e) => updateIdent({ slack_username: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              email
              <input
                value={person.identifiers.email ?? ''}
                onChange={(e) => updateIdent({ email: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded"
              />
              {getError(errors, 'identifiers', 'email') && (
                <span className="text-error text-xs">{getError(errors, 'identifiers', 'email')}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-xs">
              confluence_username
              <input
                value={person.identifiers.confluence_username ?? ''}
                onChange={(e) => updateIdent({ confluence_username: e.target.value || undefined })}
                className="bg-bg-elevated px-2 py-1 rounded"
              />
            </label>
          </fieldset>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd web && npm run build
```

Expected: PASS.

(The component is wired into the page in T8; no standalone test file — its behavior is covered via `Registry.test.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PersonRow.tsx
git commit -m "feat(web): PersonRow component (collapsed/expanded with inline form)"
```

---

## Task 7: `ProjectRow` component

**Files:**
- Create: `web/src/components/ProjectRow.tsx`

- [ ] **Step 1: Implement `web/src/components/ProjectRow.tsx`**

```tsx
import { useState, type JSX } from 'react';
import type { Project } from '@shared/types.js';
import type { ApiErrorIssue } from '@shared/types.js';
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
        {dirty && <span aria-label="dirty" className="w-2 h-2 bg-accent rounded-full" />}
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
```

- [ ] **Step 2: Verify build**

```bash
cd web && npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ProjectRow.tsx
git commit -m "feat(web): ProjectRow component (collapsed/expanded with routing form)"
```

---

## Task 8: `Registry.tsx` — working-copy state machine

**Files:**
- Modify: `web/src/routes/Registry.tsx` (replace stub)
- Test: `web/src/routes/Registry.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/routes/Registry.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Registry } from './Registry.js';
import * as api from '../lib/registry.js';
import { ApiCallError } from '../lib/api.js';

vi.mock('../lib/registry.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  document.head.innerHTML = '<meta name="scry-csrf" content="test-token">';
});

const renderWithRouter = (search = '') =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/registry', search }]}>
      <Registry />
    </MemoryRouter>,
  );

describe('Registry', () => {
  it('shows onboarding stub on 412', async () => {
    vi.mocked(api.getRegistry).mockRejectedValue(
      new ApiCallError(412, { error: 'config-required' }),
    );
    renderWithRouter();
    await waitFor(() => expect(screen.getByText(/onboarding/i)).toBeInTheDocument());
  });

  it('renders People tab by default', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: { ea: { name: 'EA', routing: {} } },
    });
    renderWithRouter();
    await waitFor(() => expect(screen.getByText('Andre')).toBeInTheDocument());
    expect(screen.queryByText('EA')).not.toBeInTheDocument();
  });

  it('switches to Projects tab via URL', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: { ea: { name: 'EA', routing: {} } },
    });
    renderWithRouter('?tab=projects');
    await waitFor(() => expect(screen.getByText('EA')).toBeInTheDocument());
    expect(screen.queryByText('Andre')).not.toBeInTheDocument();
  });

  it('marks a row dirty when its name changes and clears on Save', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    vi.mocked(api.putRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre Christ', identifiers: {} } },
      projects: {},
    });

    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByLabelText('expand'));
    const nameInput = screen.getByLabelText(/^name$/i);
    fireEvent.change(nameInput, { target: { value: 'Andre Christ' } });

    await waitFor(() => expect(screen.getByLabelText('dirty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.putRegistry).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText('dirty')).not.toBeInTheDocument());
  });

  it('Discard reverts working copy to server snapshot', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByLabelText('expand'));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Changed' } });
    await waitFor(() => expect(screen.getByLabelText('dirty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    await waitFor(() => expect(screen.queryByLabelText('dirty')).not.toBeInTheDocument());
  });

  it('renders path-scoped errors per row on 400 and auto-expands the row', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    vi.mocked(api.putRegistry).mockRejectedValue(
      new ApiCallError(400, {
        error: 'invalid-body',
        errors: [{ path: ['people', 'andre', 'name'], message: 'Name is required' }],
      }),
    );
    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByLabelText('expand'));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeInTheDocument());
    expect(screen.getByText(/validation failed/i)).toBeInTheDocument();
  });

  it('opens add-Person modal and adds a row', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({ people: {}, projects: {} });
    renderWithRouter();
    await waitFor(() => screen.getByRole('button', { name: /add person/i }));
    fireEvent.click(screen.getByRole('button', { name: /add person/i }));
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'jens' } });
    fireEvent.change(screen.getAllByLabelText(/name/i)[0], { target: { value: 'Jens' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(screen.getByText('Jens')).toBeInTheDocument());
    expect(screen.getByLabelText('dirty')).toBeInTheDocument();
  });

  it('confirms then deletes a row from the working copy', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByRole('button', { name: /delete andre/i }));
    await waitFor(() => expect(screen.queryByText('Andre')).not.toBeInTheDocument());
    expect(screen.getByLabelText('dirty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (will fail — stub renders different content)**

```bash
cd web && npx vitest run src/routes/Registry.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Replace `web/src/routes/Registry.tsx`**

```tsx
import { useState, useEffect, useCallback, useMemo, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiCallError } from '../lib/api.js';
import { getRegistry, putRegistry } from '../lib/registry.js';
import type { Registry as RegistryT, Person, Project, ApiErrorIssue } from '@shared/types.js';
import { PersonRow } from '../components/PersonRow.js';
import { ProjectRow } from '../components/ProjectRow.js';
import { AddRegistryEntryModal } from '../components/AddRegistryEntryModal.js';

type Tab = 'people' | 'projects';

const EMPTY: RegistryT = { people: {}, projects: {} };

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
  };

  const handleSave = async () => {
    if (!working) return;
    setSaving(true);
    setSaveErrors(null);
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
          {dirty.size > 0 && <span className="text-text-tertiary text-xs">{dirty.size} unsaved change{dirty.size === 1 ? '' : 's'}</span>}
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
        <div>
          {peopleKeys.length === 0 && <div className="p-4 text-text-tertiary italic text-sm">No people yet.</div>}
          {peopleKeys.map((k) => (
            <PersonRow
              key={k}
              entryKey={k}
              person={working.people[k]}
              dirty={dirty.has(`people:${k}`)}
              errors={errorsForKey('people', k)}
              onChange={(next) => updatePerson(k, next)}
              onDelete={() => {
                if (window.confirm(`Delete person "${k}"?`)) deletePerson(k);
              }}
            />
          ))}
        </div>
      ) : (
        <div>
          {projectKeys.length === 0 && <div className="p-4 text-text-tertiary italic text-sm">No projects yet.</div>}
          {projectKeys.map((k) => (
            <ProjectRow
              key={k}
              entryKey={k}
              project={working.projects[k]}
              dirty={dirty.has(`projects:${k}`)}
              errors={errorsForKey('projects', k)}
              onChange={(next) => updateProject(k, next)}
              onDelete={() => {
                if (window.confirm(`Delete project "${k}"?`)) deleteProject(k);
              }}
            />
          ))}
        </div>
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
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/routes/Registry.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Run all web tests**

```bash
cd web && npx vitest run
```

Expected: all web tests pass.

- [ ] **Step 6: Run all server tests**

```bash
cd /Users/I578221/Library/CloudStorage/OneDrive-SAPSE/Documents/the-product-kitchen/Playground/scry
npx vitest run
```

Expected: all server tests pass.

- [ ] **Step 7: Web build**

```bash
cd web && npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/routes/Registry.tsx web/src/routes/Registry.test.tsx
git commit -m "feat(web): Registry route — tabs, working-copy, Save/Discard, row-scoped errors"
```

---

## Task 9: Per-route CSRF rejection + manual smoke handoff

**Files:**
- Test: `src/server/routes/registry.csrf.test.ts`

- [ ] **Step 1: Add per-route CSRF rejection test**

Create `src/server/routes/registry.csrf.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Hono } from 'hono';
import { csrfRequired } from '../middleware/csrf.js';
import { generateCsrfToken } from '../middleware/csrf-token.js';
import { buildRegistryRoute } from './registry.js';

let dir: string;
let cfg: string;
let app: Hono;

beforeEach(() => {
  generateCsrfToken();
  dir = mkdtempSync(join(tmpdir(), 'scry-registry-csrf-'));
  cfg = join(dir, 'scry.config.yaml');
  writeFileSync(cfg, 'llm: {}\nmcp_servers: {}\nsearch_tools: {}\n');
  app = new Hono();
  app.use('*', csrfRequired());
  app.route('/api/registry', buildRegistryRoute({ configPath: () => cfg }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CSRF enforcement on /api/registry', () => {
  it('GET works without CSRF (read-only)', async () => {
    const r = await app.request('/api/registry');
    expect(r.status).toBe(200);
  });
  it('PUT without X-Scry-Csrf returns 403', async () => {
    const r = await app.request('/api/registry', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registry: { people: {}, projects: {} } }),
    });
    expect(r.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd /Users/I578221/Library/CloudStorage/OneDrive-SAPSE/Documents/the-product-kitchen/Playground/scry
npx vitest run src/server/routes/registry.csrf.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
echo "---"
cd web && npx vitest run
```

Expected: all server and web tests pass.

- [ ] **Step 4: Manual smoke (paused for Avi to run)**

```bash
cd /Users/I578221/Library/CloudStorage/OneDrive-SAPSE/Documents/the-product-kitchen/Playground/scry
npm run build
node dist/cli/index.js serve
```

Verify in the browser:

1. Sidebar shows three nav links: Search · MCPs · **Registry**.
2. Click Registry → People tab is active by default. URL shows `/registry?tab=people` (or `/registry` with no tab → defaults to people).
3. Click **Projects** → URL becomes `/registry?tab=projects`. Refresh → still on Projects.
4. Click expand on a row → inline form appears with name / role / teams / aliases / projects / identifiers fields.
5. Edit `name` → yellow dirty dot appears on the row; "1 unsaved change" appears next to Save.
6. Click **Discard** → confirm → row reverts; dirty indicator clears.
7. Edit again, click **Save changes** → name persists; dirty clears; refresh confirms persistence.
8. Click **+ Add Person** → modal → enter `key=jens-r`, `name=Jens R` → Add → row appears expanded in People list with dirty dot. Save → persists.
9. Try **+ Add Person** with key `BAD KEY` → inline error "Key must be a lowercase slug…" → modal stays open.
10. Try **+ Add Person** with an existing key → inline error "already exists in people."
11. Edit a person's email to `not-an-email` → Save → 400 → row auto-expands, email field shows "Invalid email", banner shows "Validation failed."
12. Switch to Projects tab → click expand on `ea` (or any existing project) → edit `routing.slack_channels` chip → add a new chip via Enter → dirty dot. Save → persists.
13. Run a CLI search referencing the project: `scry "<query naming the project>"`. The system prompt sent to Claude should include the new `slack_channels` value.
14. Browser back/forward across `/`, `/mcps`, `/registry` keeps the sidebar mounted; the session list does not reload.
15. Open `~/.config/scry/scry.config.yaml` — comments above and below the `registry:` block survive byte-for-byte. (`.scry.config.yaml.bak` carries the prior state.)
16. Click Delete on a row → confirm → row disappears; Save → persists; reload confirms.

If any step fails, report the specific step number and observed behavior.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/registry.csrf.test.ts
git commit -m "test(server): per-route CSRF rejection on /api/registry"
```

- [ ] **Step 6: Push + open PR (after smoke passes)**

```bash
gh auth switch --hostname github.com --user aviralv
git push -u origin feat/registry-editor-f
gh pr create --base main --title "feat: Registry editor (Plan F)" --body "$(cat <<'EOF'
Implements Plan F from docs/superpowers/specs/2026-05-31-scry-registry-editor-f-design.md.

## Surfaces
- New `/registry` route — People + Projects tabs (URL-synced via `?tab=`); inline expand-to-edit rows; working-copy / Save / Discard pattern; row-scoped error rendering with auto-expand on validation failure.
- Sidebar gains third NavLink (Search · MCPs · Registry).

## Server
- `/api/registry` — GET returns the registry (or 412 config-required); PUT validates with `RegistrySchema`, calls `writeConfig({ registry })`, returns 200 with the saved registry on success or 400 with path-scoped `errors[]` on validation failure.

## Reuses everything from Plan E
- `RegistrySchema` + `PersonSchema` + `ProjectSchema` (already in `src/config/schema.ts`)
- `writeConfig` + `proper-lockfile` + atomic write
- `ApiErrorBody` + `ApiCallError.message` formatting of path-scoped errors
- `react-router-dom` + jsdom test infra

No new dependencies.

## Tests
- Server: 9 route + 2 CSRF + 1 golden comment-preservation test
- Web: 9 ChipsInput + 7 modal + 8 Registry route + 4 lib client = 28 new web tests

## Manual smoke verified
Per plan T9 Step 4. People/Projects tabs, Add modal, working-copy Save/Discard, row-scoped error rendering on 400, comment preservation outside the registry block.
EOF
)"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| Routing (`/registry` + sidebar nav) | T2 |
| Server route GET/PUT with 200/400/412 | T1 |
| Inherits CSRF middleware + per-route test | T9 |
| Empty-registry default `{ people: {}, projects: {} }` from GET | T1 |
| Working-copy state machine (server / working / dirty / saveErrors) | T8 |
| URL-synced active tab (`?tab=people` / `?tab=projects`) | T8 |
| Row component with collapsed/expanded form | T6, T7 |
| `ChipsInput` shared by teams / aliases / projects / slack_channels / people | T4 |
| `AddRegistryEntryModal` shared between tabs (slug + name) | T5 |
| Per-row error rendering with auto-expand on path-scoped issues | T6, T7, T8 |
| Single PUT replaces whole registry | T1, T8 |
| Discard reverts working copy to server snapshot | T8 |
| Comment-loss UI copy ("will be deleted on save") | T8 |
| Comment preservation outside registry block (golden test) | T1 |
| Typed API client `getRegistry` / `putRegistry` | T3 |
| 412 maps to onboarding-stub empty state | T8 |
| 400 with `errors[]` populates `ApiCallError.body.errors` for row mapping | T3, T8 |
| CLI integration: edit project routing → next search uses it (E2E deferred to Plan I) | acceptance criterion only |

## Self-review

- **Spec coverage:** every spec section maps to a task. CLI integration is the one acceptance criterion deferred to Plan I — explicitly called out.
- **Placeholders:** none. Every step has runnable code or an exact command.
- **Type consistency:**
  - `Registry`, `Person`, `Project` shapes are the existing types from `src/config/types.ts` — no redefinition. Re-exported via `src/shared/types.ts` (T3 ensures this).
  - `ApiErrorIssue` shape `{ path: string[]; message: string }` consistent in T6, T7, T8 (all use `path[0] === group && path[1] === key` for row filtering, and `path[2..]` for field matching inside the row).
  - `Tab = 'people' | 'projects'` consistent across `Registry.tsx`, `AddRegistryEntryModal` (`group` prop), and the URL search-param parser.
  - `RegistryT` alias used inside `Registry.tsx` to disambiguate from the component name `Registry`. `import type { Registry as RegistryT }`.
  - `getRegistry` / `putRegistry` signatures match between T3 (definition) and T8 (consumption).
- **Sequencing:** T1 produces working software in isolation (curl-testable). T2's stub keeps the build green while leaf components land. T8 is the only task that integrates everything; if its test pyramid is too tall, the working-copy state machine is broken into substeps mid-task by the test cases themselves. Each task's commit leaves the tree green.
- **No shared file conflicts within a single PR.** T2's modifications to `App.tsx`, `LibrarySidebar.tsx`, `index.ts` are landed once; T8 only modifies `Registry.tsx` (replacing the T2 stub).
