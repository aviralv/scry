export type SsrfReason =
  | 'invalid-url'
  | 'scheme-not-allowed'
  | 'http-only-allowed-on-localhost'
  | 'private-address-blocked'
  | 'link-local-blocked';

export type SsrfResult =
  | { ok: true }
  | { ok: false; reason: SsrfReason; detail?: string };

const RFC1918_RANGES: Array<[number[], number]> = [
  // [base octets prefix, prefix length]
  [[10], 8],
  [[172, 16], 12],
  [[192, 168], 16],
];

const LINK_LOCAL_PREFIX = [169, 254];

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIPv4(octets: number[]): SsrfReason | null {
  if (octets[0] === LINK_LOCAL_PREFIX[0] && octets[1] === LINK_LOCAL_PREFIX[1]) {
    return 'link-local-blocked';
  }
  for (const [prefix, prefixLen] of RFC1918_RANGES) {
    if (prefixLen === 8 && octets[0] === prefix[0]) return 'private-address-blocked';
    if (prefixLen === 12 && octets[0] === prefix[0] && octets[1] >= 16 && octets[1] <= 31) {
      return 'private-address-blocked';
    }
    if (prefixLen === 16 && octets[0] === prefix[0] && octets[1] === prefix[1]) {
      return 'private-address-blocked';
    }
  }
  return null;
}

export function isAllowedBaseUrl(url: string): SsrfResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'scheme-not-allowed', detail: parsed.protocol };
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (parsed.protocol === 'http:' && !isLocalhost) {
    return { ok: false, reason: 'http-only-allowed-on-localhost' };
  }

  // For non-localhost hosts, also block private IPv4 ranges.
  if (!isLocalhost) {
    const octets = parseIPv4(host);
    if (octets) {
      const blocked = isPrivateIPv4(octets);
      if (blocked) return { ok: false, reason: blocked };
    }
    // For hostnames (not bare IPs) we don't resolve — DNS-rebinding is a
    // residual risk documented in the spec. Best-effort.
  }

  return { ok: true };
}
