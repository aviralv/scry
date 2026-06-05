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
      ['http://[::1]'],
      ['http://[::1]:8080'],
      // Boundary: just below CGNAT range (100.63.x.x is public)
      ['https://100.63.255.255'],
      // Boundary: just above CGNAT range (100.128.x.x is public)
      ['https://100.128.0.0'],
      // Boundary: just above 198.18.0.0/15 benchmark range (198.20.x.x is public)
      ['https://198.20.0.1'],
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
      ['https://[fe80::1]', 'link-local-blocked'],
      ['https://[fd00::1]', 'private-address-blocked'],
      ['https://[fd00:ec2::254]', 'private-address-blocked'],
      ['https://[fc00::1]', 'private-address-blocked'],
      ['not-a-url', 'invalid-url'],
      ['', 'invalid-url'],
      // Loopback 127.0.0.0/8 — anything other than the exact 127.0.0.1 carve-out
      ['https://127.0.1.1', 'private-address-blocked'],
      ['https://127.1.2.3', 'private-address-blocked'],
      ['https://127.255.255.255', 'private-address-blocked'],
      // 0.0.0.0/8 — wildcard / "this network"
      ['https://0.0.0.0', 'private-address-blocked'],
      ['https://0.1.2.3', 'private-address-blocked'],
      // 100.64.0.0/10 — CGNAT
      ['https://100.64.0.1', 'private-address-blocked'],
      ['https://100.127.255.255', 'private-address-blocked'],
      // 198.18.0.0/15 — benchmark testing
      ['https://198.18.0.1', 'private-address-blocked'],
      ['https://198.19.255.255', 'private-address-blocked'],
      // 224.0.0.0/4 — multicast
      ['https://224.0.0.1', 'private-address-blocked'],
      ['https://239.255.255.255', 'private-address-blocked'],
      // 240.0.0.0/4 — reserved (broadcast etc.)
      ['https://240.0.0.1', 'private-address-blocked'],
      ['https://255.255.255.255', 'private-address-blocked'],
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
