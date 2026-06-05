// scripts/eval-synthesis.ts
//
// Synthesis-quality eval. Runs YAML fixtures through Anthropic's Messages
// API with the exact system prompt scry's engine builds, then scores the
// answer against forbidden/required regex patterns.
//
// Why this is a separate script (not a vitest test):
//   - Network + cost: each fixture is one Messages API call.
//   - Non-deterministic: model output varies. We run sample_count > 1 and
//     report pass rate, not a binary pass/fail.
//
// Run: `npm run eval:synthesis`
//
// Config:
//   ANTHROPIC_API_KEY  required, or
//   ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL  for proxies (Hyperspace, etc.)
//   EVAL_MODEL         default: claude-haiku-4-5-20251001
//   EVAL_SAMPLES       default: 3 (per fixture)
//   EVAL_FILTER        default: '' — substring match on fixture filename

import { readFileSync, readdirSync } from 'fs';
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
  passRate: number;       // fraction of samples with zero forbidden hits AND zero required misses
  cleanRate: number;      // fraction with zero forbidden hits (the bug-specific metric)
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
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    sampleResults.push(scoreSample(text, fixture));
  }

  const clean = sampleResults.filter((s) => s.forbiddenHits.length === 0).length;
  const fullPass = sampleResults.filter((s) => s.forbiddenHits.length === 0 && s.requiredMisses.length === 0).length;

  return {
    fixture,
    samples: sampleResults,
    passRate: fullPass / samples,
    cleanRate: clean / samples,
  };
}

function printReport(results: FixtureResult[], samples: number): void {
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
    console.log(`  clean (no forbidden hits): ${cleanPct}% (${Math.round(r.cleanRate * samples)}/${samples})`);
    console.log(`  full pass (clean + all required): ${passPct}% (${Math.round(r.passRate * samples)}/${samples})`);
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

    totalClean += Math.round(r.cleanRate * samples);
    totalPass += Math.round(r.passRate * samples);
    totalSamples += samples;
  }

  console.log('');
  console.log('-'.repeat(72));
  console.log(`Overall: clean ${totalClean}/${totalSamples} (${((totalClean / totalSamples) * 100).toFixed(0)}%), full pass ${totalPass}/${totalSamples} (${((totalPass / totalSamples) * 100).toFixed(0)}%)`);
  console.log('='.repeat(72));
}

async function main(): Promise<void> {
  const samples = Number(process.env.EVAL_SAMPLES ?? '3');
  const filter = process.env.EVAL_FILTER ?? '';
  const fixtures = loadFixtures(filter);
  if (fixtures.length === 0) {
    console.error(`[eval] No fixtures matched filter "${filter}".`);
    process.exit(1);
  }
  const { client, model } = getClient();
  console.log(`[eval] model=${model} samples_per_fixture=${samples} fixtures=${fixtures.length}`);
  if (filter) console.log(`[eval] filter=${filter}`);

  const results: FixtureResult[] = [];
  for (const fx of fixtures) {
    process.stdout.write(`[eval] running ${fx.name} ... `);
    const r = await runFixture(client, model, fx, samples);
    process.stdout.write(`clean ${(r.cleanRate * 100).toFixed(0)}%\n`);
    results.push(r);
  }
  printReport(results, samples);

  // Exit non-zero if any fixture had any forbidden hit. Useful for CI later.
  const anyFail = results.some((r) => r.cleanRate < 1);
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error('[eval] fatal:', err);
  process.exit(1);
});
