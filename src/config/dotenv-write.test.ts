import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeDotEnv, DotEnvValidationError } from './dotenv-write.js';

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scry-dotenv-'));
  envPath = join(dir, '.scry.env');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeDotEnv', () => {
  it('creates the file when it does not exist', async () => {
    await writeDotEnv(envPath, { SLACK_TOKEN: 'xoxb-abc' });
    expect(readFileSync(envPath, 'utf-8')).toBe('SLACK_TOKEN=xoxb-abc\n');
  });

  it('appends new keys when the file exists', async () => {
    writeFileSync(envPath, 'EXISTING=foo\n');
    await writeDotEnv(envPath, { NEW_KEY: 'bar' });
    expect(readFileSync(envPath, 'utf-8')).toBe('EXISTING=foo\nNEW_KEY=bar\n');
  });

  it('updates an existing key in place, preserving order', async () => {
    writeFileSync(envPath, 'A=1\nB=2\nC=3\n');
    await writeDotEnv(envPath, { B: 'updated' });
    expect(readFileSync(envPath, 'utf-8')).toBe('A=1\nB=updated\nC=3\n');
  });

  it('preserves comments adjacent to unchanged keys byte-for-byte', async () => {
    const seed = '# Top comment\nA=1\n# B comment\nB=2\nC=3\n';
    writeFileSync(envPath, seed);
    await writeDotEnv(envPath, { C: 'new' });
    const out = readFileSync(envPath, 'utf-8');
    expect(out).toContain('# Top comment\n');
    expect(out).toContain('# B comment\n');
    expect(out).toContain('C=new\n');
  });

  it('quotes values containing double-quotes', async () => {
    await writeDotEnv(envPath, { Q: 'has"quote' });
    expect(readFileSync(envPath, 'utf-8')).toBe('Q="has\\"quote"\n');
  });

  it('writes safe-literal values bare', async () => {
    await writeDotEnv(envPath, { SAFE: 'abc-123_xyz.test/path:8080' });
    expect(readFileSync(envPath, 'utf-8')).toBe('SAFE=abc-123_xyz.test/path:8080\n');
  });

  it('throws DotEnvValidationError on multi-line values', async () => {
    await expect(writeDotEnv(envPath, { BAD: 'line1\nline2' })).rejects.toThrow(DotEnvValidationError);
    expect(existsSync(envPath)).toBe(false);
  });

  it('throws DotEnvValidationError on values containing \\r', async () => {
    await expect(writeDotEnv(envPath, { BAD: 'line1\rline2' })).rejects.toThrow(DotEnvValidationError);
    expect(existsSync(envPath)).toBe(false);
  });

  it('throws DotEnvValidationError on values containing \\r\\n', async () => {
    await expect(writeDotEnv(envPath, { BAD: 'line1\r\nline2' })).rejects.toThrow(DotEnvValidationError);
    expect(existsSync(envPath)).toBe(false);
  });

  it('serializes concurrent writes via the file lock', async () => {
    writeFileSync(envPath, 'A=0\n');
    await Promise.all([
      writeDotEnv(envPath, { A: '1' }),
      writeDotEnv(envPath, { B: '2' }),
    ]);
    const out = readFileSync(envPath, 'utf-8');
    expect(out).toContain('A=1\n');
    expect(out).toContain('B=2\n');
  });

  it('is a no-op when given an empty kv', async () => {
    writeFileSync(envPath, 'A=1\n');
    await writeDotEnv(envPath, {});
    expect(readFileSync(envPath, 'utf-8')).toBe('A=1\n');
  });
});
