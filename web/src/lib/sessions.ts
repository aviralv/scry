// web/src/lib/sessions.ts
import type { SessionRow } from '@shared/types.js';
import { apiFetch, apiJson } from './api.js';

export async function listSessions(opts?: { limit?: number; before?: number; beforeId?: string }): Promise<SessionRow[]> {
  const params = new URLSearchParams();
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.before !== undefined) params.set('before', String(opts.before));
  if (opts?.beforeId !== undefined) params.set('beforeId', opts.beforeId);
  const qs = params.toString();
  const data = await apiJson<{ sessions: SessionRow[] }>(`/api/sessions${qs ? `?${qs}` : ''}`);
  return data.sessions;
}

export async function getSession(id: string): Promise<SessionRow> {
  return apiJson<SessionRow>(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function patchSession(id: string, patch: { title?: string }): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`patch failed: ${res.status}`);
  }
}

export async function deleteSession(id: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`delete failed: ${res.status}`);
  }
}
