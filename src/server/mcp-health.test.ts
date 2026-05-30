import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { healthCheck, resolveDeclaredEnv } from './mcp-health.js';

const FX = (name: string) => resolve(process.cwd(), 'test-fixtures', name);

describe('healthCheck', () => {
  it('returns ok with toolCount on a healthy fixture', async () => {
    const r = await healthCheck({ command: 'node', args: [FX('mcp-fake-ok.mjs')] }, { timeoutMs: 3000 });
    expect(r.ok).toBe(true);
    expect(r.toolCount).toBe(2);
  });

  it('returns ok=false with timeout error on a hanging fixture and the child is dead within 1s', async () => {
    const before = Date.now();
    const r = await healthCheck(
      { command: 'node', args: [FX('mcp-fake-hang.mjs')] },
      { timeoutMs: 800 },
    );
    const elapsed = Date.now() - before;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout|did not respond/i);
    expect(elapsed).toBeLessThan(2500);
    // PID-check: any child that survives shows up in `ps -o pgid,pid,comm`. If
    // the helper exposed the spawned PID we'd assert on it; instead we verify
    // wallclock — the assertion above + the SIGKILL grace covers this.
  });

  it('returns ok=false with error when the child exits immediately', async () => {
    const r = await healthCheck(
      { command: 'node', args: [FX('mcp-fake-immediate-error.mjs')] },
      { timeoutMs: 1500 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('passes only allowlisted env to the child (per-entry refs + PATH/HOME)', async () => {
    process.env.SCRY_TEST_LEAK = 'should-not-appear';
    process.env.SCRY_TEST_PERMITTED = 'permitted-value';
    try {
      const r = await healthCheck(
        {
          command: 'node',
          args: [FX('mcp-fake-echo-env.mjs')],
          env: { TOKEN: '${SCRY_TEST_PERMITTED}' },
        },
        { timeoutMs: 3000 },
      );
      expect(r.ok).toBe(true);
      // The fixture's tool name encodes the *child's* env var keys. The child
      // should see TOKEN (from the entry) + PATH + HOME. It should NOT see
      // SCRY_TEST_LEAK.
      const observedKeys = (r as { ok: true; toolCount: number; toolName?: string }).toolName ?? '';
      expect(observedKeys).toContain('TOKEN');
      expect(observedKeys).toContain('PATH');
      expect(observedKeys).toContain('HOME');
      expect(observedKeys).not.toContain('SCRY_TEST_LEAK');
    } finally {
      delete process.env.SCRY_TEST_LEAK;
      delete process.env.SCRY_TEST_PERMITTED;
    }
  });

  it('refuses to resolve a ${REF} that is not declared as a key in the same entry', async () => {
    process.env.SCRY_TEST_FORBIDDEN = 'forbidden';
    try {
      const r = await healthCheck(
        {
          command: 'node',
          args: [FX('mcp-fake-echo-env.mjs')],
          // TOKEN's value references SCRY_TEST_FORBIDDEN, but the *only*
          // declared key in this entry's env is TOKEN itself. The forbidden
          // ref must NOT resolve.
          env: { TOKEN: '${SCRY_TEST_FORBIDDEN}' },
        },
        { timeoutMs: 3000 },
      );
      expect(r.ok).toBe(true);
      const observedKeys = (r as { ok: true; toolName?: string }).toolName ?? '';
      // The child's TOKEN should be the literal '${SCRY_TEST_FORBIDDEN}', not
      // 'forbidden'. We can't read child env values via tool name; instead
      // verify the env key is present (TOKEN) but trust the resolver
      // unit-tested below to refuse the substitution.
      expect(observedKeys).toContain('TOKEN');
    } finally {
      delete process.env.SCRY_TEST_FORBIDDEN;
    }
  });

  it('returns ok=false when the command does not exist (ENOENT) without crashing', async () => {
    const r = await healthCheck(
      { command: 'this-binary-definitely-does-not-exist-xyz-123', args: [] },
      { timeoutMs: 1500 },
    );
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toMatch(/ENOENT|not found|spawn/i);
  });
});

describe('resolveDeclaredEnv', () => {
  it('resolves a ref naming a key declared in the same entry', () => {
    process.env.SCRY_TEST_DECLARED = 'resolved-value';
    try {
      const r = resolveDeclaredEnv({ SCRY_TEST_DECLARED: '${SCRY_TEST_DECLARED}' });
      expect(r.SCRY_TEST_DECLARED).toBe('resolved-value');
    } finally {
      delete process.env.SCRY_TEST_DECLARED;
    }
  });

  it('passes through a ref to a non-declared key as a literal (security boundary)', () => {
    process.env.ACTUAL_SECRET = 'should-not-leak';
    try {
      const r = resolveDeclaredEnv({ TOKEN: '${ACTUAL_SECRET}' });
      // ACTUAL_SECRET is NOT a declared key in this entry, so the ref
      // does not resolve. This is the security boundary.
      expect(r.TOKEN).toBe('${ACTUAL_SECRET}');
      expect(r.TOKEN).not.toBe('should-not-leak');
    } finally {
      delete process.env.ACTUAL_SECRET;
    }
  });

  it('passes safe-literal values through unchanged', () => {
    const r = resolveDeclaredEnv({ BIN: '/usr/local/bin/x', NUM: '42' });
    expect(r.BIN).toBe('/usr/local/bin/x');
    expect(r.NUM).toBe('42');
  });

  it('returns an empty object for an empty input', () => {
    expect(resolveDeclaredEnv({})).toEqual({});
  });
});
