// web/src/lib/csrf.ts
// Reads the per-boot CSRF token. Two paths:
//   1. Production: index.html has <meta name="scry-csrf" content="<token>"> (server replaces __SCRY_CSRF__).
//   2. Vite dev: the placeholder is unchanged, so we fetch /api/csrf on first call.

let cached: string | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/csrf');
  if (!res.ok) throw new Error(`CSRF fetch failed: ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export async function getCsrfToken(): Promise<string> {
  if (cached) return cached;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="scry-csrf"]');
  const metaValue = meta?.content;

  if (metaValue && metaValue !== '__SCRY_CSRF__') {
    cached = metaValue;
    return cached;
  }

  cached = await fetchToken();
  return cached;
}
