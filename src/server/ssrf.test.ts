import { describe, it, expect } from 'vitest';
import { isAllowedBaseUrl } from './ssrf.js';

describe('isAllowedBaseUrl', () => {
  describe('allowed', () => {
    it.each([
      ['https://api.anthropic.com'],
      ['https://api.anthropic.com/v1'],
      ['https://api.openrouter.ai/api/v1'],
      ['http://localhost:6655/anthropic/'],
      ['http://localhost'],
      ['http://127.0.0.1:8080'],
      ['http://127.0.0.1'],
    ])('accepts %s', (url) => {
      expect(isAllowedBaseUrl(url)).toEqual({ ok: true });
    });
  });

  describe('rejected', () => {
    it.each([
      ['http://api.anthropic.com', 'http-only-allowed-on-localhost'],
      ['ftp://example.com', 'scheme-not-allowed'],
      ['file:///etc/passwd', 'scheme-not-allowed'],
      ['https://10.0.0.1', 'private-address-blocked'],
      ['https://10.255.255.255', 'private-address-blocked'],
      ['https://172.16.0.1', 'private-address-blocked'],
      ['https://172.31.0.1', 'private-address-blocked'],
      ['https://192.168.1.1', 'private-address-blocked'],
      ['https://169.254.169.254', 'link-local-blocked'],
      ['not-a-url', 'invalid-url'],
      ['', 'invalid-url'],
    ])('rejects %s with reason %s', (url, reason) => {
      const r = isAllowedBaseUrl(url);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    });

    it('rejects 172.32.0.1 (just outside the 172.16/12 range)', () => {
      // Outside RFC1918 — should this be allowed? Yes — only 172.16-172.31 is private.
      const r = isAllowedBaseUrl('https://172.32.0.1');
      expect(r.ok).toBe(true);
    });
  });
});
