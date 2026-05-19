import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseDotEnv, loadDotEnvFile } from '../../src/config/dotenv.js';

describe('parseDotEnv', () => {
  it('parses KEY=value pairs', () => {
    const result = parseDotEnv('FOO=bar\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('skips blank lines and comments', () => {
    const result = parseDotEnv('# comment\n\nFOO=bar\n  # indented comment\nBAZ=qux\n');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips matching quotes around values', () => {
    const result = parseDotEnv('FOO="bar"\nBAZ=\'qux\'\nNAKED=plain');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux', NAKED: 'plain' });
  });

  it('preserves = inside values', () => {
    const result = parseDotEnv('TOKEN=abc=def=ghi');
    expect(result).toEqual({ TOKEN: 'abc=def=ghi' });
  });

  it('trims whitespace around keys', () => {
    const result = parseDotEnv('  FOO  =bar');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('ignores malformed lines without =', () => {
    const result = parseDotEnv('FOO=bar\ngarbage\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });
});

describe('loadDotEnvFile', () => {
  let tmpDir: string;
  let envPath: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scry-dotenv-'));
    envPath = join(tmpDir, '.scry.env');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
  });

  it('loads vars from file into process.env', () => {
    delete process.env.SCRY_TEST_FOO;
    writeFileSync(envPath, 'SCRY_TEST_FOO=hello');
    loadDotEnvFile(envPath);
    expect(process.env.SCRY_TEST_FOO).toBe('hello');
  });

  it('does not override existing process.env values', () => {
    process.env.SCRY_TEST_FOO = 'shell-value';
    writeFileSync(envPath, 'SCRY_TEST_FOO=file-value');
    loadDotEnvFile(envPath);
    expect(process.env.SCRY_TEST_FOO).toBe('shell-value');
  });

  it('is a no-op when file does not exist', () => {
    expect(() => loadDotEnvFile(envPath)).not.toThrow();
  });
});
