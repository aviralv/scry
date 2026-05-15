import { readFileSync } from 'fs';
import { parse } from 'yaml';
import type { ScryConfig } from './types.js';

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] ?? '';
  });
}

function resolveDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return resolveEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveDeep(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(path: string): ScryConfig {
  const raw = readFileSync(path, 'utf-8');
  const parsed = parse(raw);
  return resolveDeep(parsed) as ScryConfig;
}
