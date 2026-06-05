# Session Notes — scry

## Sessions

| Date | Theme | Key Outcome |
|------|-------|-------------|
| 2026-05-15 | Project kickoff | Scaffolded from research session; architecture defined as search orchestration over MCP |
| 2026-05-19 | npm publish + .scry.env | `@aviralv/scry@0.1.2` shipped. Registry-driven refactor (11-task plan). Live-tested → confluence auth bug → built `.scry.env` mechanism for secrets-out-of-git. End-to-end working. |
| 2026-05-23 | Plan A — web foundation | Hono server + Vite/React/Tailwind SPA shell. Origin allowlist + per-boot CSRF + tight CSP. `fetch + getReader` SSE consumer (not EventSource). Theme tokens as single rebrand surface. |
| 2026-05-25 | Plan B — engine pivot | Replaced homegrown planner/normalizer/synthesizer with `@anthropic-ai/claude-agent-sdk`. Cwd-locked to scry config dir. `allowedTools` restricted to configured MCPs. CLI flows through `runQuery`. |
| 2026-05-27 | Plan C — search rollout (C1+C2+C3) | Three-PR delivery of Perplexity-shape browser experience. Streaming search route, multi-turn follow-ups with per-turn `[N]` scoping, SQLite-backed library sidebar with insert-on-done semantics. 199 tests on main. |
| 2026-05-31 | Plan E + F shipped | MCP manager (Plan E) + Registry editor (Plan F) merged same day. Shared `writeConfig` + zod + `proper-lockfile` infrastructure. Three rounds of UX iteration on Registry editor (form → 2-col grid → single-col table). |
| 2026-06-03 | Plan G start (Tasks 1–4.5) | Onboarding wizard execution begins on branch `feat/onboarding-wizard-g`. Spec passed GPT-4.1 + Gemini 2.5 Pro adversarial review. Tasks 1–4 shipped + inserted Task 4.5 (writeConfig callback API to fix pre-existing race that would have hit wizard parallelism hard). Two real incidents: stale OneDrive untracked files corrupted reviewer signal (recovered via revert + quarantine); concurrency bug in Plan E discovered during Task 4 code review. 226 tests on branch. Resume at Task 5. |
