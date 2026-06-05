# Synthesis evals

Network-backed evals for scry's synthesis quality. Each subdirectory
targets a specific synthesis-quality bug or regression class. Fixtures are
YAML; the runner is a TypeScript script in `scripts/`.

## Why these aren't vitest tests

- Each fixture costs one Messages API call. Running them in CI on every
  push gets expensive fast.
- Model output varies. We sample N times per fixture and report a pass
  rate, not a binary pass/fail.
- These are diagnostics, not gates.

## Layout

```
tests/eval/
├── README.md                    (this file)
└── synthesis/
    └── fixtures/                (one YAML per scenario)
        ├── 01-no-affiliation-in-source.yaml
        ├── 02-verbatim-affiliation-ok.yaml
        └── ...
```

Runner: `scripts/eval-synthesis.ts` (`npm run eval:synthesis`).

## Fixture shape

```yaml
query: "<the search query Claude is answering>"

sources:
  - server: slack            # MCP server name
    tool: slack_search       # tool that "returned" this
    payload:
      title: "..."
      snippet: "..."
      author: "..."
      timestamp: "<ISO>"
      url: "https://..."

forbidden_patterns:           # JS regex; matched case-insensitively
  - "..."

required_patterns:            # JS regex; at least one match required
  - "..."

notes: |                       # human-readable rationale
  ...
```

The runner builds the production system prompt (via
`buildSystemPrompt`) and a synthetic user message containing the
already-collected tool results. The model is asked to synthesize.
Each sample is scored: zero forbidden hits = "clean"; zero forbidden +
all required matched = "full pass".

## Running

```bash
# Default: 3 samples per fixture, model claude-haiku-4-5-20251001
npm run eval:synthesis

# More samples per fixture (statistical power)
EVAL_SAMPLES=5 npm run eval:synthesis

# Filter to fixtures matching a substring
EVAL_FILTER=07 npm run eval:synthesis

# Different model
EVAL_MODEL=claude-sonnet-4-5 npm run eval:synthesis
```

Auth: `ANTHROPIC_API_KEY` for direct API, or `ANTHROPIC_AUTH_TOKEN` +
`ANTHROPIC_BASE_URL` for proxies. Exits 2 if neither is set; exits 1 if
any fixture had a forbidden hit; exits 0 on full clean.

## Synthesis fixtures — current set (7)

The first six target Issue #7 (engine fabricates parenthetical
role/affiliation labels). The seventh is hard-mode: source mentions
people whose canonical real-world affiliations are well-represented in
training data, to test whether the model "helpfully" inserts those.

Baseline (no prompt change, claude-haiku-4-5-20251001, 5 samples each):
all 7 fixtures **100% clean**. The original C1 smoke-test bug from
2026-05-26 does not reproduce on Haiku 4.5 with these fixtures —
either the model behavior has shifted, or real-world transcripts carry
more ambiguity than synthetic minimal sources do.

The eval is kept as a regression net: any future model bump, system
prompt change, or new bug report can run against this set first.

## Adding a fixture

1. Pick a number that doesn't exist yet (`07`, `08`, ...).
2. Create `tests/eval/synthesis/fixtures/NN-<slug>.yaml`.
3. Run `EVAL_FILTER=NN npm run eval:synthesis` to verify it loads and
   the patterns match the produced output as expected.
4. Document the rationale in the `notes:` field — why this fixture
   exists, what bug shape it catches.
