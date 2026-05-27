# Session Notes — scry

## Sessions

| Date | Theme | Key Outcome |
|------|-------|-------------|
| 2026-05-15 | Project kickoff | Scaffolded from research session; architecture defined as search orchestration over MCP |
| 2026-05-19 | npm publish + .scry.env | `@aviralv/scry@0.1.2` shipped. Registry-driven refactor (11-task plan). Live-tested → confluence auth bug → built `.scry.env` mechanism for secrets-out-of-git. End-to-end working. |
| 2026-05-23 | Plan A — web foundation | Hono server + Vite/React/Tailwind SPA shell. Origin allowlist + per-boot CSRF + tight CSP. `fetch + getReader` SSE consumer (not EventSource). Theme tokens as single rebrand surface. |
| 2026-05-25 | Plan B — engine pivot | Replaced homegrown planner/normalizer/synthesizer with `@anthropic-ai/claude-agent-sdk`. Cwd-locked to scry config dir. `allowedTools` restricted to configured MCPs. CLI flows through `runQuery`. |
| 2026-05-27 | Plan C — search rollout (C1+C2+C3) | Three-PR delivery of Perplexity-shape browser experience. Streaming search route, multi-turn follow-ups with per-turn `[N]` scoping, SQLite-backed library sidebar with insert-on-done semantics. 199 tests on main. |
