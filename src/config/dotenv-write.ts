import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as lockfile from 'proper-lockfile';
import { atomicWriteConfig } from './atomic-write.js';

export class DotEnvValidationError extends Error {
  constructor(public readonly key: string, public readonly reason: string) {
    super(`dotenv value for "${key}" is invalid: ${reason}`);
    this.name = 'DotEnvValidationError';
  }
}

const SAFE_LITERAL_RE = /^[A-Za-z0-9._/=:@+-]+$/;

function formatValue(v: string): string {
  if (SAFE_LITERAL_RE.test(v)) return v;
  // Quote and escape backslash + double-quote.
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface ParsedLine {
  kind: 'kv' | 'comment' | 'blank';
  key?: string;
  raw: string;        // original line content, no trailing \n
}

function parseLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  // Split on \n but keep awareness of the trailing newline.
  const lines = text.split('\n');
  // If text ends with \n, the last element is '' — drop it so we don't emit a phantom blank.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      out.push({ kind: 'blank', raw: line });
      continue;
    }
    if (trimmed.startsWith('#')) {
      out.push({ kind: 'comment', raw: line });
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      // Malformed — preserve as-is.
      out.push({ kind: 'comment', raw: line });
      continue;
    }
    const key = line.slice(0, eq).trim();
    out.push({ kind: 'kv', key, raw: line });
  }
  return out;
}

function serialize(lines: ParsedLine[]): string {
  if (lines.length === 0) return '';
  return lines.map(l => l.raw).join('\n') + '\n';
}

export async function writeDotEnv(path: string, kv: Record<string, string>): Promise<void> {
  // Validate all values BEFORE any I/O so a single bad value doesn't leave the
  // file half-written.
  for (const [k, v] of Object.entries(kv)) {
    if (/[\r\n]/.test(v)) throw new DotEnvValidationError(k, 'multi-line values are not allowed');
  }

  if (Object.keys(kv).length === 0) return;

  // proper-lockfile requires the target file to exist before locking. Create
  // an empty one if needed; we'll write content via atomicWriteConfig.
  if (!existsSync(path)) {
    await fs.writeFile(path, '', 'utf-8');
  }

  const release = await lockfile.lock(path, {
    stale: 10_000,
    retries: { retries: 5, minTimeout: 50 },
    onCompromised: (err: Error) => {
      console.error(`[writeDotEnv] lock compromised on ${path}: ${err.message}`);
    },
  });
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const lines = parseLines(raw);

    const remaining = new Map(Object.entries(kv));
    // Update in place where the key already exists.
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind === 'kv' && l.key !== undefined && remaining.has(l.key)) {
        const v = remaining.get(l.key) as string;
        lines[i] = { kind: 'kv', key: l.key, raw: `${l.key}=${formatValue(v)}` };
        remaining.delete(l.key);
      }
    }
    // Append remaining new keys in insertion order.
    for (const [k, v] of remaining) {
      lines.push({ kind: 'kv', key: k, raw: `${k}=${formatValue(v)}` });
    }

    const out = serialize(lines);
    await atomicWriteConfig(path, out);
  } finally {
    await release();
  }
}
