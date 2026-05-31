import { apiJson } from './api.js';
import type { Registry } from '@shared/types.js';

export async function getRegistry(): Promise<Registry> {
  const r = await apiJson<{ registry: Registry }>('/api/registry');
  return r.registry;
}

export async function putRegistry(registry: Registry): Promise<Registry> {
  const r = await apiJson<{ registry: Registry }>('/api/registry', {
    method: 'PUT',
    body: JSON.stringify({ registry }),
  });
  return r.registry;
}
