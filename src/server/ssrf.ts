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

function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isPrivateIPv6(host: string): SsrfReason | null {
  if (!host.includes(':')) return null; // not IPv6
  // fe80::/10 — link-local. First 10 bits are 1111 1110 10, so the first
  // segment of the address begins with fe8x–febx.
  if (/^fe[89ab][0-9a-f]/i.test(host)) return 'link-local-blocked';
  // fc00::/7 — unique-local. First 7 bits are 1111 110, so first byte is
  // 0xfc or 0xfd.
  if (/^f[cd][0-9a-f]{2}/i.test(host)) return 'private-address-blocked';
  return null;
}

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
  // Loopback 127.0.0.0/8 — the exact 127.0.0.1 case is already permitted by
  // the isLocalhost carve-out upstream; any other 127.x.x.x is private.
  if (octets[0] === 127) return 'private-address-blocked';
  // RFC1918
  for (const [prefix, prefixLen] of RFC1918_RANGES) {
    if (prefixLen === 8 && octets[0] === prefix[0]) return 'private-address-blocked';
    if (prefixLen === 12 && octets[0] === prefix[0] && octets[1] >= 16 && octets[1] <= 31) {
      return 'private-address-blocked';
    }
    if (prefixLen === 16 && octets[0] === prefix[0] && octets[1] === prefix[1]) {
      return 'private-address-blocked';
    }
  }
  // 0.0.0.0/8 — "this network" / wildcard
  if (octets[0] === 0) return 'private-address-blocked';
  // 100.64.0.0/10 — CGNAT (100.64–100.127)
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
    return 'private-address-blocked';
  }
  // 198.18.0.0/15 — benchmark testing (198.18–198.19)
  if (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) {
    return 'private-address-blocked';
  }
  // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved (first octet 224–255)
  if (octets[0] >= 224) return 'private-address-blocked';
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

  const host = unbracket(parsed.hostname.toLowerCase());
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (parsed.protocol === 'http:' && !isLocalhost) {
    return { ok: false, reason: 'http-only-allowed-on-localhost' };
  }

  // For non-localhost hosts, block private IPv4 and IPv6 ranges.
  if (!isLocalhost) {
    const octets = parseIPv4(host);
    if (octets) {
      const blocked = isPrivateIPv4(octets);
      if (blocked) return { ok: false, reason: blocked };
    }
    // IPv6 — string-shape check on leading bytes.
    const blockedV6 = isPrivateIPv6(host);
    if (blockedV6) return { ok: false, reason: blockedV6 };
    // For hostnames (not bare IPs) we don't resolve — DNS-rebinding is a
    // residual risk documented in the spec. Best-effort.
  }

  return { ok: true };
}
