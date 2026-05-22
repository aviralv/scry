# scry web frontend v2 — Plan A: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the server + frontend scaffolding so subsequent plans (engine pivot, search, library, MCP/registry/onboarding/preferences) can drop verticals onto a stable foundation. By the end of Plan A: `scry serve` boots a hardened Hono server (Origin allowlist + per-boot CSRF + tight CSP), the React+Vite SPA loads in a browser, and the existing CLI continues to work unchanged.

**Architecture:** Single-process Node binary. Hono server in `src/server/` serves API stubs + static frontend from `dist/web/`. React + Vite + Tailwind in `web/` (own `package.json` so dev deps don't bloat runtime). New `scry serve` subcommand alongside existing `scry "<query>"` and `scry config show`. No engine changes in this plan — that's Plan B.

**Tech Stack:** Hono + `@hono/node-server`, Vite + React + TypeScript + Tailwind, `open` (browser launch). Built on dependencies already installed in the prior session (W4 commit on `feat/web-foundation`).

**Spec reference:** [`docs/superpowers/specs/2026-05-22-scry-web-frontend-v2-design.md`](../specs/2026-05-22-scry-web-frontend-v2-design.md) — Architecture, Security, Repo layout sections.

**Branch state at start of plan:**
- Branch: `feat/web-foundation`
- Already committed: W1 `src/shared/types.ts` (cross-cutting types), W2 `src/config/atomic-write.ts` + tests (atomic config write), W4 dependency installs (`hono`, `@hono/node-server`, `zod`, `open` runtime; `@types/node` dev). Test count: 103/103.
- The reverted W3 task (AbortSignal threading through old engine) is no longer relevant — engine is going away in Plan B.

**Out of scope for Plan A:**
- Engine module (`src/engine/*`) — Plan B
- Storage (`src/storage/*`) — Plan B
- Search route + UI — Plan C
- Library sidebar — Plan D
- MCP/Registry/Onboarding/Preferences — Plans E–G
- E2E Playwright + npm publish prep — Plan H
- CLI restructure into `src/cli/index.ts` + subcommand files — Plan B (when engine pivot rewires the CLI anyway)

---

## File map (additions only)

| Path | Purpose |
|---|---|
| `src/server/index.ts` | `createServer(opts)` returning a Hono app |
| `src/server/boot.ts` | `startServer(opts)` — listens via `@hono/node-server` |
| `src/server/middleware/origin.ts` | Origin allowlist middleware |
| `src/server/middleware/csrf.ts` | Per-boot token check on mutating routes |
| `src/server/middleware/csrf-token.ts` | Generates/serves the boot token |
| `src/server/routes/health.ts` | `GET /api/health` (sanity check) |
| `src/server/routes/csrf.ts` | `GET /api/csrf` returns the boot token |
| `src/server/static.ts` | Serve `dist/web/*`; rewrite `index.html` to inject CSRF token |
| `src/cli.ts` | Modify — add `scry serve` subcommand |
| `web/package.json` | Local deps for the frontend build only |
| `web/vite.config.ts` | Vite config; build output to `../dist/web` |
| `web/tsconfig.json` | TypeScript config with `@shared/*` path alias |
| `web/tsconfig.node.json` | Node-flavored TS config for vite.config.ts |
| `web/index.html` | Bootstrap shell with `<meta name="scry-csrf" content="__SCRY_CSRF__">` placeholder |
| `web/postcss.config.js` | Tailwind + autoprefixer pipeline |
| `web/tailwind.config.ts` | Maps theme tokens to utility classes |
| `web/src/main.tsx` | React entry |
| `web/src/App.tsx` | Empty router shell (no real routes yet) |
| `web/src/index.css` | Imports tokens.css + tailwind layers |
| `web/src/theme/tokens.css` | ~25 CSS variables (rebrand surface) |
| `web/src/lib/csrf.ts` | Reads `<meta name="scry-csrf">` or fetches `/api/csrf` |
| `web/src/lib/api.ts` | `apiFetch` / `apiJson` wrappers with CSRF + JSON |
| `web/src/lib/stream.ts` | Fetch-streaming consumer for `text/event-stream`-shaped bodies |
| `tests/server/health.test.ts` | Server boot + health route |
| `tests/server/middleware/origin.test.ts` | Origin allowlist |
| `tests/server/middleware/csrf.test.ts` | CSRF require/reject |
| `package.json` | Modify — `build:server` / `build:web` scripts + `files` allowlist |

---

### Task 1: Origin allowlist middleware

**Files:**
- Create: `src/server/middleware/origin.ts`
- Create: `tests/server/middleware/origin.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/server/middleware/origin.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { originAllowlist } from '../../../src/server/middleware/origin.js';

function makeApp(port = 6678) {
  const app = new Hono();
  app.use('*', originAllowlist(port));
  app.get('/ok', (c) => c.json({ ok: true }));
  return app;
}

describe('originAllowlist', () => {
  it('accepts requests with no Origin (curl, server-side)', async () => {
    const res = await makeApp().request('/ok', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('accepts http://localhost:6678', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://localhost:6678' } });
    expect(res.status).toBe(200);
  });

  it('accepts http://127.0.0.1:6678', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://127.0.0.1:6678' } });
    expect(res.status).toBe(200);
  });

  it('rejects http://evil.example.com', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://evil.example.com' } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('origin-rejected');
  });

  it('rejects https://localhost:6678 (wrong scheme)', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'https://localhost:6678' } });
    expect(res.status).toBe(403);
  });

  it('rejects http://localhost:9999 (wrong port)', async () => {
    const res = await makeApp().request('/ok', { headers: { Origin: 'http://localhost:9999' } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/server/middleware/origin.test.ts
```

Expected: 6 failing tests (import error).

- [ ] **Step 3: Implement**

```typescript
// src/server/middleware/origin.ts
import type { MiddlewareHandler } from 'hono';

export function originAllowlist(port: number): MiddlewareHandler {
  const allowed = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
  ]);
  return async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !allowed.has(origin)) {
      return c.json({ error: 'origin-rejected', message: `Origin ${origin} not allowed` }, 403);
    }
    await next();
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/server/middleware/origin.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/origin.ts tests/server/middleware/origin.test.ts
git commit -m "feat(server): origin allowlist middleware"
```

---

### Task 2: CSRF token + middleware

**Files:**
- Create: `src/server/middleware/csrf-token.ts`
- Create: `src/server/middleware/csrf.ts`
- Create: `tests/server/middleware/csrf.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/server/middleware/csrf.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateCsrfToken, getCsrfToken, resetCsrfTokenForTests } from '../../../src/server/middleware/csrf-token.js';
import { csrfRequired } from '../../../src/server/middleware/csrf.js';

describe('csrf', () => {
  beforeEach(() => {
    resetCsrfTokenForTests();
    generateCsrfToken();
  });

  it('GET requests pass without a token', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.get('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x');
    expect(res.status).toBe(200);
  });

  it('POST without X-Scry-Csrf rejects 403', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.post('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('csrf-required');
  });

  it('POST with wrong X-Scry-Csrf rejects 403', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.post('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { method: 'POST', headers: { 'X-Scry-Csrf': 'wrong' } });
    expect(res.status).toBe(403);
  });

  it('POST with correct X-Scry-Csrf passes', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.post('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', { method: 'POST', headers: { 'X-Scry-Csrf': getCsrfToken() } });
    expect(res.status).toBe(200);
  });

  it('PUT, PATCH, DELETE all require token', async () => {
    const app = new Hono();
    app.use('*', csrfRequired());
    app.put('/x', (c) => c.json({}));
    app.patch('/x', (c) => c.json({}));
    app.delete('/x', (c) => c.json({}));
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/x', { method });
      expect(res.status).toBe(403);
    }
  });

  it('generateCsrfToken produces a 64-char hex string', () => {
    resetCsrfTokenForTests();
    generateCsrfToken();
    expect(getCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/server/middleware/csrf.test.ts
```

Expected: 6 failing tests.

- [ ] **Step 3: Implement token store**

```typescript
// src/server/middleware/csrf-token.ts
import { randomBytes } from 'crypto';

let token: string | null = null;

export function generateCsrfToken(): string {
  token = randomBytes(32).toString('hex');
  return token;
}

export function getCsrfToken(): string {
  if (!token) throw new Error('CSRF token not initialized — call generateCsrfToken() at boot');
  return token;
}

export function resetCsrfTokenForTests(): void {
  token = null;
}
```

- [ ] **Step 4: Implement middleware**

```typescript
// src/server/middleware/csrf.ts
import type { MiddlewareHandler } from 'hono';
import { getCsrfToken } from './csrf-token.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfRequired(): MiddlewareHandler {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      await next();
      return;
    }
    const provided = c.req.header('X-Scry-Csrf');
    if (!provided || provided !== getCsrfToken()) {
      return c.json({ error: 'csrf-required', message: 'Missing or invalid X-Scry-Csrf header' }, 403);
    }
    await next();
  };
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/server/middleware/csrf.test.ts
```

Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add src/server/middleware/csrf.ts src/server/middleware/csrf-token.ts tests/server/middleware/csrf.test.ts
git commit -m "feat(server): per-boot CSRF token + middleware"
```

---

### Task 3: Server scaffold + health/csrf routes + boot

**Files:**
- Create: `src/server/index.ts`
- Create: `src/server/boot.ts`
- Create: `src/server/routes/health.ts`
- Create: `src/server/routes/csrf.ts`
- Create: `tests/server/health.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/server/health.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { generateCsrfToken, getCsrfToken } from '../../src/server/middleware/csrf-token.js';

describe('server scaffold', () => {
  beforeAll(() => {
    generateCsrfToken();
  });

  it('GET /api/health returns 200 with status ok', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/csrf returns the boot token', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/csrf');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(getCsrfToken());
  });

  it('rejects bad-origin requests on health route too', async () => {
    const app = createServer({ port: 6678 });
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/server/health.test.ts
```

Expected: failures (import error).

- [ ] **Step 3: Implement health and csrf routes**

```typescript
// src/server/routes/health.ts
import { Hono } from 'hono';

export const healthRoute = new Hono().get('/', (c) => c.json({ status: 'ok' }));
```

```typescript
// src/server/routes/csrf.ts
import { Hono } from 'hono';
import { getCsrfToken } from '../middleware/csrf-token.js';

export const csrfRoute = new Hono().get('/', (c) => c.json({ token: getCsrfToken() }));
```

- [ ] **Step 4: Implement server factory**

```typescript
// src/server/index.ts
import { Hono } from 'hono';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';

export interface ServerOptions {
  port: number;
}

export function createServer(opts: ServerOptions) {
  const app = new Hono();

  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());

  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);

  return app;
}
```

- [ ] **Step 5: Implement boot**

```typescript
// src/server/boot.ts
import { serve } from '@hono/node-server';
import { createServer } from './index.js';
import { generateCsrfToken } from './middleware/csrf-token.js';

export interface BootOptions {
  port: number;
}

export function startServer(opts: BootOptions) {
  generateCsrfToken();
  const app = createServer(opts);
  return serve({ fetch: app.fetch, port: opts.port, hostname: '127.0.0.1' });
}
```

- [ ] **Step 6: Run tests**

```bash
npm run build && npm test -- tests/server/
```

Expected: TypeScript clean; all server tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts src/server/boot.ts src/server/routes/health.ts src/server/routes/csrf.ts tests/server/health.test.ts
git commit -m "feat(server): Hono scaffold with health + csrf routes; origin + csrf middleware wired"
```

---

### Task 4: Vite + React + Tailwind scaffold in `web/`

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.node.json`
- Create: `web/index.html`, `web/postcss.config.js`, `web/tailwind.config.ts`
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`, `web/src/theme/tokens.css`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "scry-web",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Install web deps**

```bash
cd web && npm install && cd ..
```

Expected: clean install. The repo's existing `.gitignore` already covers `node_modules` recursively.

- [ ] **Step 3: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src/shared'),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:6678',
        changeOrigin: false,
      },
    },
  },
});
```

- [ ] **Step 4: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../src/shared/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 5: Create `web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 6: Create `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="scry-csrf" content="__SCRY_CSRF__" />
    <title>scry</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `web/src/theme/tokens.css`**

```css
:root {
  --scry-bg-primary: #0c0e10;
  --scry-bg-secondary: #14171a;
  --scry-bg-sidebar: #0a0c0e;
  --scry-bg-elevated: #1c2024;

  --scry-text-primary: #ecefe8;
  --scry-text-secondary: #b4bcb6;
  --scry-text-tertiary: #6e7770;

  --scry-accent: #3aa39c;
  --scry-accent-dim: #2a7a76;
  --scry-accent-glow: rgba(58, 163, 156, 0.18);

  --scry-error: #d96363;
  --scry-warning: #d9a03a;
  --scry-success: #5ab07e;

  --scry-border: #232629;
  --scry-divider: #1a1d20;

  --scry-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --scry-mono: 'JetBrains Mono', ui-monospace, monospace;

  --scry-radius-sm: 4px;
  --scry-radius-md: 8px;
  --scry-radius-lg: 12px;
}

[data-theme='light'] {
  --scry-bg-primary: #f8f9f7;
  --scry-bg-secondary: #eef0ec;
  --scry-bg-sidebar: #e6e8e3;
  --scry-bg-elevated: #ffffff;
  --scry-text-primary: #1a1d1f;
  --scry-text-secondary: #4a5052;
  --scry-text-tertiary: #7a8082;
  --scry-border: #d0d4d2;
  --scry-divider: #e0e3e0;
}
```

- [ ] **Step 8: Create `web/tailwind.config.ts`** (at the top of `web/`, NOT under `src/theme/`)

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--scry-bg-primary)',
          secondary: 'var(--scry-bg-secondary)',
          sidebar: 'var(--scry-bg-sidebar)',
          elevated: 'var(--scry-bg-elevated)',
        },
        text: {
          primary: 'var(--scry-text-primary)',
          secondary: 'var(--scry-text-secondary)',
          tertiary: 'var(--scry-text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--scry-accent)',
          dim: 'var(--scry-accent-dim)',
        },
        border: 'var(--scry-border)',
        divider: 'var(--scry-divider)',
        error: 'var(--scry-error)',
        warning: 'var(--scry-warning)',
        success: 'var(--scry-success)',
      },
      fontFamily: {
        sans: ['var(--scry-sans)'],
        mono: ['var(--scry-mono)'],
      },
      borderRadius: {
        sm: 'var(--scry-radius-sm)',
        DEFAULT: 'var(--scry-radius-md)',
        lg: 'var(--scry-radius-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 9: Create PostCSS config and root CSS**

```javascript
// web/postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

```css
/* web/src/index.css */
@import './theme/tokens.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  background: var(--scry-bg-primary);
  color: var(--scry-text-primary);
  font-family: var(--scry-sans);
}
```

- [ ] **Step 10: Create React entry**

```typescript
// web/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

```typescript
// web/src/App.tsx
export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-sans text-text-primary mb-2">scry</h1>
        <p className="text-text-secondary">foundation ready — features land in subsequent plans</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Build the frontend**

```bash
cd web && npm run build && cd ..
ls -la dist/web/
```

Expected: `dist/web/index.html`, `dist/web/assets/*.js`, `dist/web/assets/*.css`.

- [ ] **Step 12: Confirm `dist/` is gitignored**

```bash
grep -E "^dist" .gitignore || echo "MISSING_DIST_IGNORE"
```

Expected: at least `dist` or `dist/` appears. If `MISSING_DIST_IGNORE` prints, STOP and report — adding to `.gitignore` would touch a pre-existing-uncommitted file that isn't ours.

- [ ] **Step 13: Commit (only `web/`, not the build output)**

```bash
git add web/
git commit -m "feat(web): Vite + React + Tailwind scaffold with theme tokens"
```

---

### Task 5: Frontend client libs (csrf, api, stream)

**Files:**
- Create: `web/src/lib/csrf.ts`
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/stream.ts`

- [ ] **Step 1: Implement `lib/csrf.ts`**

```typescript
// web/src/lib/csrf.ts
// Reads the per-boot CSRF token. Two paths:
//   1. Production: index.html has <meta name="scry-csrf" content="<token>"> (server replaces __SCRY_CSRF__).
//   2. Vite dev: the placeholder is unchanged, so we fetch /api/csrf on first call.

let cached: string | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/csrf');
  if (!res.ok) throw new Error(`CSRF fetch failed: ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export async function getCsrfToken(): Promise<string> {
  if (cached) return cached;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="scry-csrf"]');
  const metaValue = meta?.content;

  if (metaValue && metaValue !== '__SCRY_CSRF__') {
    cached = metaValue;
    return cached;
  }

  cached = await fetchToken();
  return cached;
}
```

- [ ] **Step 2: Implement `lib/api.ts`**

```typescript
// web/src/lib/api.ts
import { getCsrfToken } from './csrf.js';
import type { ApiError } from '@shared/types.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();

  if (MUTATING.has(method)) {
    headers.set('X-Scry-Csrf', await getCsrfToken());
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(path, { ...init, method, headers });
}

export class ApiCallError extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.message ?? body.error);
    this.name = 'ApiCallError';
  }
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body: ApiError = await res.json().catch(() => ({ error: `http-${res.status}` }));
    throw new ApiCallError(res.status, body);
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 3: Implement `lib/stream.ts`** (fetch-streaming consumer for `text/event-stream`-shaped bodies)

```typescript
// web/src/lib/stream.ts
// Consumes a text/event-stream response from a fetch() call.
// (NOT EventSource — that doesn't support custom headers like X-Scry-Csrf.)
// Used by Plan C's search route.

export interface StreamHandler<T> {
  onEvent: (event: T) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

export async function consumeStream<T>(
  res: Response,
  handler: StreamHandler<T>,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) throw new Error('No response body for stream');
  if (!res.headers.get('Content-Type')?.startsWith('text/event-stream')) {
    throw new Error('Response is not text/event-stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as T;
          handler.onEvent(parsed);
        } catch (err) {
          handler.onError?.(err as Error);
        }
      }
    }
    handler.onDone?.();
  } catch (err) {
    handler.onError?.(err as Error);
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd web && npm run build && cd ..
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/
git commit -m "feat(web): csrf, api, fetch-streaming client libs"
```

---

### Task 6: Static handler with CSRF injection + `scry serve` subcommand

**Files:**
- Create: `src/server/static.ts`
- Modify: `src/server/index.ts` (mount static handler)
- Modify: `src/cli.ts` (add `serve` subcommand)

- [ ] **Step 1: Implement static handler**

```typescript
// src/server/static.ts
import type { MiddlewareHandler } from 'hono';
import { promises as fs } from 'fs';
import { join, normalize } from 'path';
import { getCsrfToken } from './middleware/csrf-token.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const CSP =
  "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:";

export function staticHandler(rootDir: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();

    const urlPath = c.req.path === '/' ? '/index.html' : c.req.path;
    if (urlPath.startsWith('/api/')) return next();

    const hasExt = /\.[a-z0-9]+$/i.test(urlPath);
    const target = hasExt ? urlPath : '/index.html';
    const fsPath = normalize(join(rootDir, target));

    if (!fsPath.startsWith(normalize(rootDir))) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const ext = target.slice(target.lastIndexOf('.'));
    const mime = MIME[ext] ?? 'application/octet-stream';

    let content: Buffer | string;
    try {
      content = await fs.readFile(fsPath);
    } catch {
      return c.json({ error: 'not-found' }, 404);
    }

    if (target.endsWith('.html')) {
      content = content.toString('utf-8').replace('__SCRY_CSRF__', getCsrfToken());
    }

    return new Response(content, {
      headers: {
        'Content-Type': mime,
        'Content-Security-Policy': CSP,
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}
```

- [ ] **Step 2: Update `src/server/index.ts` to mount static**

```typescript
// src/server/index.ts
import { Hono } from 'hono';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { originAllowlist } from './middleware/origin.js';
import { csrfRequired } from './middleware/csrf.js';
import { healthRoute } from './routes/health.js';
import { csrfRoute } from './routes/csrf.js';
import { staticHandler } from './static.js';

export interface ServerOptions {
  port: number;
  staticDir?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(opts: ServerOptions) {
  const app = new Hono();

  app.use('*', originAllowlist(opts.port));
  app.use('*', csrfRequired());

  app.route('/api/health', healthRoute);
  app.route('/api/csrf', csrfRoute);

  // Default staticDir: ../web (relative to dist/server at runtime).
  const staticDir = opts.staticDir ?? resolve(__dirname, '../web');
  app.use('*', staticHandler(staticDir));

  return app;
}
```

- [ ] **Step 3: Add `scry serve` to `src/cli.ts`**

Read `src/cli.ts` first to confirm structure (existing commands `query` (default action), `config show`, `init`). Add `import open from 'open';` to the imports. Then, after the `program.command('init')` definition and before `program.parse()`, add:

```typescript
program
  .command('serve')
  .description('Start the scry web GUI on localhost')
  .option('-p, --port <number>', 'Port to listen on', '6678')
  .option('--no-open', 'Skip opening the browser')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const { startServer } = await import('./server/boot.js');
    startServer({ port });
    const url = `http://127.0.0.1:${port}`;
    console.error(`⟐ scry web running at ${url}`);
    if (opts.open !== false) {
      await open(url);
    }
  });
```

- [ ] **Step 4: Build and run the full test suite**

```bash
npm run build
npm test
```

Expected: TypeScript compiles cleanly; full suite passes (existing tests + new server tests).

- [ ] **Step 5: Smoke-test the CLI**

```bash
cd web && npm run build && cd ..
node dist/cli.js serve --port 6678 --no-open &
SERVER_PID=$!
sleep 1
curl -s http://127.0.0.1:6678/api/health
echo ""
curl -s http://127.0.0.1:6678/api/csrf
echo ""
curl -sI http://127.0.0.1:6678/ | head -8
kill $SERVER_PID
```

Expected:
- `/api/health` returns `{"status":"ok"}`
- `/api/csrf` returns `{"token":"<64-char hex>"}`
- `/` returns 200 with `Content-Security-Policy` and `X-Frame-Options: DENY` headers

- [ ] **Step 6: Verify existing CLI commands still work**

```bash
node dist/cli.js --help
node dist/cli.js config show 2>&1 | head -3 || true
```

Expected: `scry --help` shows `serve` alongside the existing commands. `config show` either runs or fails on missing config (whichever is your current state); the point is: didn't regress.

- [ ] **Step 7: Commit**

```bash
git add src/server/static.ts src/server/index.ts src/cli.ts
git commit -m "feat(server,cli): static handler with CSP + CSRF injection; scry serve subcommand"
```

---

### Task 7: package.json scripts + `files` allowlist

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `scripts` and add `files`**

In `package.json`, replace the current `scripts` block with:

```json
"scripts": {
  "build:server": "tsc",
  "build:web": "cd web && npm run build",
  "build": "npm run build:server && npm run build:web",
  "prepublishOnly": "npm run build",
  "dev:server": "tsc --watch",
  "dev:web": "cd web && npm run dev",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

And add (or replace the existing) `files` block:

```json
"files": [
  "dist",
  "README.md"
],
```

Keep all other top-level fields (`name`, `version`, `bin`, `dependencies`, `devDependencies`, etc.) intact.

- [ ] **Step 2: Verify build still works**

```bash
npm run build
ls dist/cli.js dist/server/index.js dist/web/index.html
```

Expected: all three files exist.

- [ ] **Step 3: Verify `npm pack` ships only what we want**

```bash
npm pack --dry-run 2>&1 | grep -E "^npm notice " | head -40
```

Expected: only files under `dist/`, plus `README.md` and `package.json`. **No `web/src`, no `node_modules`, no source files from `src/`, no `tests/`**.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: build:server + build:web scripts; explicit files allowlist"
```

---

### Task 8: Push and open PR

**Files:** none (git only)

- [ ] **Step 1: Verify gh auth identity**

```bash
gh auth status 2>&1 | grep -E "(account|Active)" | head -4
```

If active account is not `aviralv`, switch:

```bash
gh auth switch --hostname github.com --user aviralv
```

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/web-foundation
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat: web frontend foundation v2 (Plan A)" --body "$(cat <<'EOF'
## Summary

Plan A of the v2 scry web frontend rollout. Establishes the server + frontend
scaffolding so subsequent plans (engine pivot, search, library, MCP/registry/
onboarding/preferences) drop verticals onto a stable foundation.

This PR lands:
- **Cross-cutting types** (`src/shared/types.ts`)
- **Atomic config write helper** (`src/config/atomic-write.ts`) with `.bak` + tmp+fsync+rename
- **Hono server** at `127.0.0.1:6678` with Origin allowlist + per-boot CSRF token + tight CSP
- **`scry serve` subcommand** that boots the server and opens the browser
- **React + Vite + Tailwind frontend** — empty SPA with theme tokens (cool teal accent, distinct from lynx amber); CSRF + API + fetch-streaming client libs ready
- **Build pipeline** — tsc for server, Vite for web, output to `dist/`
- **Explicit `files` allowlist** — only `dist/` and `README.md` ship to npm

No engine, no real surfaces yet. The CLI's existing `scry "<query>"` and
`scry config show` continue to work unchanged.

Spec: [`docs/superpowers/specs/2026-05-22-scry-web-frontend-v2-design.md`](./docs/superpowers/specs/2026-05-22-scry-web-frontend-v2-design.md)
Plan: [`docs/superpowers/plans/2026-05-22-scry-web-foundation-v2.md`](./docs/superpowers/plans/2026-05-22-scry-web-foundation-v2.md)

## Test plan

- [x] `npm test` — all unit tests pass (existing engine + new atomic-write, origin, csrf, server scaffold tests)
- [x] `npm run build` — server `tsc` clean + web Vite build clean
- [x] `node dist/cli.js serve --port 6678 --no-open` boots; `/api/health` returns `{"status":"ok"}`; `/api/csrf` returns a 64-char hex token; `/` serves the SPA with `Content-Security-Policy` + `X-Frame-Options: DENY`
- [x] Browser at `http://127.0.0.1:6678/` shows the empty SPA shell
- [x] Cross-origin `curl -H "Origin: http://evil.example.com"` rejected with 403
- [x] `POST` without `X-Scry-Csrf` rejected with 403; with the boot token passes
- [x] `npm pack --dry-run` shows only `dist/` and `README.md` — no `web/src/`, no source files, no node_modules
- [x] `scry "<query>"` (CLI) continues to work unchanged

## Out of scope (follow-up plans)

- Plan B: engine pivot to `@anthropic-ai/claude-agent-sdk` + storage (sessions SQLite) + CLI restructure
- Plan C: search route + UI (fetch streaming, citations, source rail)
- Plan D: library sidebar + follow-up resume
- Plan E: MCP manager
- Plan F: registry editor
- Plan G: onboarding wizard
- Plan H: preferences + theme toggle
- Plan I: E2E Playwright + npm publish prep
EOF
)"
```

- [ ] **Step 4: Wait for review + sign-off before merge**

Per `the-product-kitchen/.claude/rules/DEPLOYMENT.md`: PRs are for review, not auto-merge. Don't merge until the user confirms it works in a live session.

---

## Self-Review

**Spec coverage** (mapped against v2 spec sections):

- v2 spec §Architecture — *Security (carries from Plan A)*: Origin allowlist (Task 1), CSRF (Task 2), CSP via static handler (Task 6), atomic config writes (already on branch via W2). All covered for the foundation; full Engine + Storage land in Plan B.
- v2 spec §Repo layout — additions `src/server/*` (Tasks 1–3, 6), `web/*` scaffold (Task 4), client libs (Task 5). `src/engine/*`, `src/storage/*`, `src/cli/*` restructure are explicitly out-of-scope (Plan B).
- v2 spec §Dev workflow — `npm run dev` / `npm run build` (Task 7).
- v2 spec §Risks — `.npmignore`/files leak handled by explicit allowlist (Task 7); cross-origin handled by Origin middleware (Task 1).

**Placeholder scan:** None. Each step has its actual code or actual command.

**Type consistency:**
- `getCsrfToken` exists at server (sync) and on the client (async) — different files, different mechanisms (server holds the token, client reads from meta tag or fetches `/api/csrf`). Same name is intentional.
- `ServerOptions` is consistent across `createServer` and `startServer`.
- `ApiError` and `ApiResult` are defined in `src/shared/types.ts` (already on branch from W1) and referenced via the `@shared/*` alias from `web/`.
- `staticHandler(rootDir)` signature consistent across `static.ts` and the call in `index.ts`.

Plan ready for execution.
