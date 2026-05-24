import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { atomicWriteConfig } from '../../src/config/atomic-write.js';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('atomicWriteConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scry-atomic-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes new file atomically when no existing file', async () => {
    const target = join(dir, 'scry.config.yaml');
    await atomicWriteConfig(target, 'hello: world\n');
    expect(readFileSync(target, 'utf-8')).toBe('hello: world\n');
    expect(existsSync(`${target}.bak`)).toBe(false);
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('backs up existing file before overwriting', async () => {
    const target = join(dir, 'scry.config.yaml');
    writeFileSync(target, 'old: content\n');
    await atomicWriteConfig(target, 'new: content\n');
    expect(readFileSync(target, 'utf-8')).toBe('new: content\n');
    expect(readFileSync(`${target}.bak`, 'utf-8')).toBe('old: content\n');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('overwrites prior .bak on subsequent writes', async () => {
    const target = join(dir, 'scry.config.yaml');
    writeFileSync(target, 'v1\n');
    await atomicWriteConfig(target, 'v2\n');
    await atomicWriteConfig(target, 'v3\n');
    expect(readFileSync(target, 'utf-8')).toBe('v3\n');
    expect(readFileSync(`${target}.bak`, 'utf-8')).toBe('v2\n');
  });

  it('leaves the live file intact if the write fails before rename', async () => {
    const target = join(dir, 'scry.config.yaml');
    writeFileSync(target, 'original\n');
    // Path that can't be written: a directory
    const badTarget = join(dir, 'a-dir');
    const fs = await import('fs/promises');
    await fs.mkdir(badTarget);
    await expect(atomicWriteConfig(badTarget, 'x')).rejects.toThrow();
    // Original target untouched
    expect(readFileSync(target, 'utf-8')).toBe('original\n');
  });
});
