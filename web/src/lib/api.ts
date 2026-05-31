// web/src/lib/api.ts
import { getCsrfToken } from './csrf.js';
import type { ApiErrorBody } from '@shared/types.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();

  if (MUTATING.has(method)) {
    headers.set('X-Scry-Csrf', await getCsrfToken());
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(path, { ...init, method, headers });
}

export class ApiCallError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(buildErrorMessage(body));
    this.name = 'ApiCallError';
  }
}

function buildErrorMessage(body: ApiErrorBody): string {
  if (body.message) return body.message;
  if (body.errors && body.errors.length > 0) {
    return body.errors
      .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
      .join(' · ');
  }
  return body.error;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body: ApiErrorBody = await res.json().catch(() => ({ error: `http-${res.status}` }));
    throw new ApiCallError(res.status, body);
  }
  return (await res.json()) as T;
}
