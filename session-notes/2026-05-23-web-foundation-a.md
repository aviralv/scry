# 2026-05-23 — Plan A: web foundation

## Theme

Built the server + SPA shell that everything in C1/C2/C3 sits on top of. No features yet — just the scaffold (with security and streaming wired up) so feature work doesn't have to redo this.

## What got built

### Server (Hono)

- `src/server/index.ts` — `createServer({ port, staticDir? })` returns the Hono app. Mounts global `originAllowlist` + `csrfRequired` middleware, plus `/api/health`, `/api/csrf`, and the static handler.
- `src/server/middleware/origin.ts` — allowlist `localhost`, `127.0.0.1`, `[::1]` for the bound port. Cross-origin requests get 403.
- `src/server/middleware/csrf.ts` + `csrf-token.ts` — per-boot `X-Scry-Csrf` token (32 random bytes hex). Mutating methods (`POST/PUT/PATCH/DELETE`) without the header → 403.
- `src/server/static.ts` — serves `dist/web/`, injects a tight CSP + bootstrapped CSRF token via `replaceAll('__SCRY_CSRF__', ...)`.
- `src/server/boot.ts` — `startServer()` wraps `createServer` with `@hono/node-server` and resolves only when actually listening on `127.0.0.1:port` (so `EADDRINUSE` surfaces structurally).
- `src/cli/serve.ts` — `scry serve --port 6678 [--no-open]` subcommand, opens the URL via the `open` package.

### Frontend (Vite + React + Tailwind, all strict TS)

- `web/` workspace with its own `tsconfig.json` and Vite config. Build output goes to `../dist/web/` so the server's static handler can find it.
- `web/src/theme/tokens.css` — single rebrand surface, ~25 CSS variables. Cool teal accent (`#3aa39c`) on near-black (`#0c0e10`); Inter (sans) + JetBrains Mono. Tailwind config maps utility classes (`bg-bg-primary`, `text-accent`, etc.) to these vars.
- `web/src/lib/csrf.ts` — reads the boot-injected token at mount. Real env wins over file values.
- `web/src/lib/api.ts` — `apiFetch(path, init)` auto-injects `X-Scry-Csrf` on mutating methods; `apiJson<T>` wraps + parses.
- `web/src/lib/stream.ts` — `consumeStream<T>(res, handler, signal?)` consumer for `text/event-stream` over `fetch + getReader`. **NOT `EventSource`** — `EventSource` can't send custom headers like `X-Scry-Csrf`.
- `web/src/App.tsx` placeholder showed palette swatches so the rebrand could be eyeballed before real surfaces shipped (replaced wholesale in C1).

### Tooling discipline

- `web/.gitignore` for build artifacts (root `.gitignore` left alone — Avi has uncommitted work there).
- Atomic config writes (`src/config/atomic-write.ts`): tmp + fsync + rename + .bak. Foundation for any future config mutation.

## Key Decisions

- **127.0.0.1 binding only** — never `0.0.0.0`. Personal localhost tool, not a service.
- **`fetch + getReader` over `EventSource`** for SSE consumption. `EventSource` rules out custom headers, which would have forced cookie-based CSRF (browser-managed) and needed the static handler to set them. The fetch path is simpler and lets Plan C's streaming route emit typed `RunQueryEvent` JSON without ceremony.
- **Origin allowlist + per-boot CSRF + tight CSP** instead of any auth layer. The threat model is "stray browser tab on the same machine," not "remote attacker."
- **Theme tokens in CSS variables, not Tailwind theme config**, so a future visual identity change is a single file (`tokens.css`) edit, not a recompile.
- **No `EventSource` polyfills, no streaming server-state libraries.** Direct fetch + manual SSE parse keeps the contract visible.

## Files touched (created)

- `src/server/{index,boot,static}.ts`
- `src/server/middleware/{origin,csrf,csrf-token}.ts`
- `src/server/routes/{health,csrf}.ts`
- `src/cli/serve.ts`
- `src/shared/types.ts` (`CsrfBootstrap`, `ApiError`, `ApiResult<T>`)
- `src/config/atomic-write.ts`
- `web/` workspace (Vite config, Tailwind config, tokens.css, lib/api/csrf/stream, App placeholder, main.tsx)

## Next Steps

1. Pivot the engine to `@anthropic-ai/claude-agent-sdk` (Plan B) — current "deterministic fanout" turned out to be `always-call-all + per-source templates`, which Claude can do natively.
2. Then build the actual search route + UI on top of this foundation (Plan C).

## Learnings

- **Fetch-based SSE is not the default in 2026 docs.** Most React-streaming guides assume `EventSource`. Picking the right consumer up front saved a refactor when CSRF requirements landed.
- **Atomic config writes are cheap to install before they're needed.** Plan B's config changes during init flow would have been unsafe without the tmp+fsync+rename pattern.
- **Theme tokens before any real component.** Made it easy to keep C1/C2/C3 components consistent without a token-renaming pass.

## Tags
`#scry` `#web-foundation` `#hono` `#vite` `#csp` `#csrf` `#sse`
