const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Sanitize a URL string for use in `<a href="...">`. Returns the URL string
 * if it's a valid http(s) URL, or `undefined` otherwise. Reject javascript:,
 * data:, file:, and unparseable inputs.
 */
export function sanitizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (!ALLOWED_SCHEMES.has(u.protocol)) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}
