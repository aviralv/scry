import { describe, it, expect } from 'vitest';
import { raceAbort } from '../../src/core/abort.js';

describe('raceAbort', () => {
  it('resolves when the inner promise resolves first', async () => {
    const signal = new AbortController().signal;
    const result = await raceAbort(Promise.resolve(42), signal);
    expect(result).toBe(42);
  });

  it('rejects with AbortError when signal aborts first', async () => {
    const ctl = new AbortController();
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 1000));
    setTimeout(() => ctl.abort(), 10);
    await expect(raceAbort(slow, ctl.signal)).rejects.toThrow(/aborted/i);
  });

  it('rejects immediately if signal already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(raceAbort(Promise.resolve(1), ctl.signal)).rejects.toThrow(/aborted/i);
  });
});
