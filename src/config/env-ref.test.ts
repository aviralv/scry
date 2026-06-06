// src/config/env-ref.test.ts
import { describe, it, expect } from 'vitest';
import { ENV_REF_RE, isEnvRef, parseEnvRef } from './env-ref.js';

describe('env-ref', () => {
  describe('isEnvRef', () => {
    it('accepts canonical refs', () => {
      expect(isEnvRef('${ANTHROPIC_API_KEY}')).toBe(true);
      expect(isEnvRef('${A}')).toBe(true);
      expect(isEnvRef('${SCRY_LLM_TOKEN}')).toBe(true);
      expect(isEnvRef('${VAR_1}')).toBe(true);
      expect(isEnvRef('${V0}')).toBe(true);
    });

    it('rejects literal values', () => {
      expect(isEnvRef('sk-ant-abc123')).toBe(false);
      expect(isEnvRef('hello world')).toBe(false);
      expect(isEnvRef('')).toBe(false);
    });

    it('rejects refs with non-canonical names', () => {
      // lowercase
      expect(isEnvRef('${anthropic_api_key}')).toBe(false);
      // leading digit
      expect(isEnvRef('${1VAR}')).toBe(false);
      // hyphen
      expect(isEnvRef('${MY-VAR}')).toBe(false);
      // dot
      expect(isEnvRef('${MY.VAR}')).toBe(false);
      // empty body
      expect(isEnvRef('${}')).toBe(false);
    });

    it('rejects refs with surrounding text', () => {
      expect(isEnvRef('prefix${VAR}')).toBe(false);
      expect(isEnvRef('${VAR}suffix')).toBe(false);
      expect(isEnvRef('${A} ${B}')).toBe(false);
    });

    it('rejects unclosed or malformed braces', () => {
      expect(isEnvRef('${VAR')).toBe(false);
      expect(isEnvRef('VAR}')).toBe(false);
      expect(isEnvRef('$VAR')).toBe(false);
      expect(isEnvRef('$ {VAR}')).toBe(false);
    });
  });

  describe('parseEnvRef', () => {
    it('returns the captured name for canonical refs', () => {
      expect(parseEnvRef('${ANTHROPIC_API_KEY}')).toBe('ANTHROPIC_API_KEY');
      expect(parseEnvRef('${A}')).toBe('A');
      expect(parseEnvRef('${SCRY_LLM_TOKEN}')).toBe('SCRY_LLM_TOKEN');
    });

    it('returns null for non-refs', () => {
      expect(parseEnvRef('literal')).toBe(null);
      expect(parseEnvRef('${lowercase}')).toBe(null);
      expect(parseEnvRef('')).toBe(null);
      expect(parseEnvRef('${VAR}suffix')).toBe(null);
    });
  });

  describe('ENV_REF_RE', () => {
    it('is exported as a stable RegExp instance', () => {
      // No `g` flag — safe to call .test/.exec without lastIndex side effects.
      expect(ENV_REF_RE.flags).not.toContain('g');
      expect(ENV_REF_RE.test('${X}')).toBe(true);
      expect(ENV_REF_RE.test('${X}')).toBe(true); // confirms no state leak
    });
  });
});
