// scripts/eval-synthesis.ts
//
// Synthesis-quality eval. Runs YAML fixtures through Anthropic's Messages
// API with the exact system prompt scry's engine builds, then scores the
// answer against forbidden/required regex patterns.
//
// Why this is a separate script (not a vitest test):
//   - Network + cost: each fixture is one Messages API call.
//   - These are diagnostics, not gates.
//
// Run: `npm run eval:synthesis`
//
// Determinism:
//   The eval pins `temperature: 0` so the same model + same fixtures
//   produce the same scores run-to-run. This is required for the
//   "clean rate" metric to be a reproducible regression signal rather
//   than a sampling artifact. Override with EVAL_TEMPERATURE if you
//   want exploratory variance (results not comparable across runs).
//
// Caveat:
//   The fixtures hand the model a synthetic "tool results" preamble in a
//   single user turn — bypassing the agent loop where the production bug
//   was originally observed. A clean baseline here means the synthesis
//   step doesn't fabricate affiliations *given clean source content in a
//   single-turn synthesis*. It does NOT prove the agent loop is clean.
//   Re-run the eval whenever the model is bumped; do not assume the
//   prompt prevents the behavior.
//
// Config:
//   ANTHROPIC_API_KEY  required, or
//   ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL  for proxies (Hyperspace, etc.)
//   EVAL_MODEL         default: claude-haiku-4-5-20251001
//   EVAL_SAMPLES       default: 3 (per fixture)
//   EVAL_FILTER        default: '' — substring match on fixture filename
//   EVAL_TEMPERATURE   default: 0 (deterministic)
//   EVAL_OUTPUT        optional: JSON results path; written even if exit non-zero

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '../src/engine/system-prompt.js';
import type { Registry } from '../src/config/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, '..', 'tests', 'eval', 'synthesis', 'fixtures');

interface FixtureSource {
  server: string;
  tool: string;
  payload: {
    title?: string;
    snippet?: string;
    author?: string;
    timestamp?: string;
    url?: string;
  };
}

interface Fixture {
  name: string;
  query: string;
  sources: FixtureSource[];
  forbidden_patterns: string[];
  required_patterns: string[];
  notes?: string;
}

interface SampleResult {
  text: string;
  forbiddenHits: Array<{ pattern: string; match: string }>;
  requiredMisses: string[];
}

interface FixtureResult {
  fixture: Fixture;
  samples: SampleResult[];
  cleanCount: number;     // raw integer — number of samples with zero forbidden hits
  fullPassCount: number;  // raw integer — clean + zero required misses
  totalSamples: number;   // raw integer — same as samples.length
  cleanRate: number;      // cleanCount / totalSamples
  passRate: number;       // fullPassCount / totalSamples
}

function loadFixtures(filter: string): Fixture[] {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.yaml')).sort();
  const out: Fixture[] = [];
  for (const f of files) {
    if (filter && !f.includes(filter)) continue;
    const raw = readFileSync(join(FIXTURES_DIR, f), 'utf-8');
    const parsed = parseYaml(raw) as Omit<Fixture, 'name'>;
    out.push({ name: f.replace(/\.yaml$/, ''), ...parsed });
  }
  return out;
}

/**
 * Format a fixture's sources the way the runQuery loop would surface them
 * to Claude: numbered, with server attribution, then the title/snippet/etc.
 *
 * The user prompt we send is the search query plus an "Already-collected
 * tool results" preamble. We're bypassing the agent loop's tool-calling
 * phase and asking the model to synthesize from a fixed corpus — that's
 * the variable we're measuring.
 */
function buildUserPrompt(fixture: Fixture): string {
  const lines: string[] = [];
  lines.push(`Question: ${fixture.query}`);
  lines.push('');
  lines.push('You have already called your search tools. Here are the results, numbered for citation:');
  lines.push('');
  fixture.sources.forEach((src, i) => {
    const idx = i + 1;
    lines.push(`[${idx}] (server: ${src.server}, tool: ${src.tool})`);
    if (src.payload.title) lines.push(`  title: ${src.payload.title}`);
    if (src.payload.author) lines.push(`  author: ${src.payload.author}`);
    if (src.payload.timestamp) lines.push(`  timestamp: ${src.payload.timestamp}`);
    if (src.payload.url) lines.push(`  url: ${src.payload.url}`);
    if (src.payload.snippet) lines.push(`  snippet: ${src.payload.snippet}`);
    lines.push('');
  });
  lines.push('Synthesize an answer with inline [N] citations and a Sources: enumeration at the end.');
  return lines.join('\n');
}

function scoreSample(text: string, fixture: Fixture): SampleResult {
  const forbiddenHits: Array<{ pattern: string; match: string }> = [];
  for (const p of fixture.forbidden_patterns) {
    const re = new RegExp(p, 'i');
    const m = text.match(re);
    if (m) forbiddenHits.push({ pattern: p, match: m[0] });
  }
  const requiredMisses: string[] = [];
  for (const p of fixture.required_patterns) {
    const re = new RegExp(p, 'i');
    if (!re.test(text)) requiredMisses.push(p);
  }
  return { text, forbiddenHits, requiredMisses };
}

function getClient(): { client: Anthropic; model: string } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  const model = process.env.EVAL_MODEL ?? 'claude-haiku-4-5-20251001';

  if (!apiKey && !authToken) {
    console.error('[eval] No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in env. Skipping.');
    process.exit(2);
  }

  const opts: ConstructorParameters<typeof Anthropic>[0] = {};
  if (apiKey) opts.apiKey = apiKey;
  if (authToken) opts.authToken = authToken;
  if (baseURL) opts.baseURL = baseURL;
  return { client: new Anthropic(opts), model };
}

async function runFixture(
  client: Anthropic,
  model: string,
  fixture: Fixture,
  samples: number,
  temperature: number,
): Promise<FixtureResult> {
  // Use the same system prompt the engine ships so the eval reflects the
  // production prompt, not a separate copy. serverNames mirrors the
  // fixture's source servers.
  const serverNames = Array.from(new Set(fixture.sources.map((s) => s.server)));
  const empty: Registry = { people: {}, projects: {} };
  const systemPrompt = buildSystemPrompt({ registry: empty, fanoutMode: false, serverNames });
  const userPrompt = buildUserPrompt(fixture);

  const sampleResults: SampleResult[] = [];
  for (let i = 0; i < samples; i++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    sampleResults.push(scoreSample(text, fixture));
  }

  const cleanCount = sampleResults.filter((s) => s.forbiddenHits.length === 0).length;
  const fullPassCount = sampleResults.filter((s) => s.forbiddenHits.length === 0 && s.requiredMisses.length === 0).length;

  return {
    fixture,
    samples: sampleResults,
    cleanCount,
    fullPassCount,
    totalSamples: samples,
    cleanRate: cleanCount / samples,
    passRate: fullPassCount / samples,
  };
}

function printReport(results: FixtureResult[]): void {
  console.log('');
  console.log('='.repeat(72));
  console.log('Synthesis eval — fabricated affiliation labels (#7)');
  console.log('='.repeat(72));

  let totalClean = 0;
  let totalPass = 0;
  let totalSamples = 0;

  for (const r of results) {
    const cleanPct = (r.cleanRate * 100).toFixed(0);
    const passPct = (r.passRate * 100).toFixed(0);
    const status = r.cleanRate === 1 ? '✓' : r.cleanRate >= 0.7 ? '⚠' : '✗';
    console.log('');
    console.log(`${status} ${r.fixture.name}`);
    console.log(`  query: ${r.fixture.query}`);
    console.log(`  clean (no forbidden hits): ${cleanPct}% (${r.cleanCount}/${r.totalSamples})`);
    console.log(`  full pass (clean + all required): ${passPct}% (${r.fullPassCount}/${r.totalSamples})`);
    r.samples.forEach((s, i) => {
      if (s.forbiddenHits.length > 0) {
        console.log(`  sample ${i + 1}: FORBIDDEN HITS:`);
        s.forbiddenHits.forEach((h) => {
          console.log(`    pattern: ${h.pattern}`);
          console.log(`    match:   "${h.match}"`);
        });
      }
      if (s.requiredMisses.length > 0) {
        console.log(`  sample ${i + 1}: required miss: ${s.requiredMisses.join(', ')}`);
      }
    });

    totalClean += r.cleanCount;
    totalPass += r.fullPassCount;
    totalSamples += r.totalSamples;
  }

  console.log('');
  console.log('-'.repeat(72));
  console.log(`Overall: clean ${totalClean}/${totalSamples} (${((totalClean / totalSamples) * 100).toFixed(0)}%), full pass ${totalPass}/${totalSamples} (${((totalPass / totalSamples) * 100).toFixed(0)}%)`);
  console.log('='.repeat(72));
}

function writeJsonResults(
  outPath: string,
  meta: { model: string; samples: number; temperature: number },
  results: FixtureResult[],
): void {
  const payload = {
    meta,
    fixtures: results.map((r) => ({
      name: r.fixture.name,
      query: r.fixture.query,
      cleanCount: r.cleanCount,
      fullPassCount: r.fullPassCount,
      totalSamples: r.totalSamples,
      cleanRate: r.cleanRate,
      passRate: r.passRate,
      samples: r.samples,
    })),
    overall: {
      cleanCount: results.reduce((a, r) => a + r.cleanCount, 0),
      fullPassCount: results.reduce((a, r) => a + r.fullPassCount, 0),
      totalSamples: results.reduce((a, r) => a + r.totalSamples, 0),
    },
  };
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[eval] wrote results to ${outPath}`);
}

async function main(): Promise<void> {
  const samples = Number(process.env.EVAL_SAMPLES ?? '3');
  const filter = process.env.EVAL_FILTER ?? '';
  // Default to deterministic. Bumping temperature breaks regression-net
  // semantics; do it deliberately by setting EVAL_TEMPERATURE.
  const temperature = Number(process.env.EVAL_TEMPERATURE ?? '0');
  const outPath = process.env.EVAL_OUTPUT;
  const fixtures = loadFixtures(filter);
  if (fixtures.length === 0) {
    console.error(`[eval] No fixtures matched filter "${filter}".`);
    process.exit(1);
  }
  const { client, model } = getClient();
  console.log(`[eval] model=${model} samples_per_fixture=${samples} temperature=${temperature} fixtures=${fixtures.length}`);
  if (filter) console.log(`[eval] filter=${filter}`);

  const results: FixtureResult[] = [];
  for (const fx of fixtures) {
    process.stdout.write(`[eval] running ${fx.name} ... `);
    const r = await runFixture(client, model, fx, samples, temperature);
    process.stdout.write(`clean ${(r.cleanRate * 100).toFixed(0)}%\n`);
    results.push(r);
  }
  printReport(results);
  if (outPath) writeJsonResults(outPath, { model, samples, temperature }, results);

  // Exit non-zero if any fixture had any forbidden hit. With temperature=0
  // this is deterministic; in CI a flake is a real bug, not a sample artifact.
  const anyFail = results.some((r) => r.cleanRate < 1);
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error('[eval] fatal:', err);
  process.exit(1);
});
