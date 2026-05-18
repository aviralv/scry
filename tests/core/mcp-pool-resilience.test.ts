import { describe, it, expect } from 'vitest';
import { withTimeout } from '../../src/core/mcp-pool.js';

describe('withTimeout', () => {
  it('resolves when call finishes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('done'), 5000);
    expect(result).toBe('done');
  });

  it('rejects with timeout error when call exceeds limit', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 10000));
    await expect(withTimeout(slow, 50)).rejects.toThrow('timed out');
  });

  it('passes through rejection from original promise', async () => {
    const failing = Promise.reject(new Error('connection lost'));
    await expect(withTimeout(failing, 5000)).rejects.toThrow('connection lost');
  });
});
