import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import type { ScryConfig } from './types.js';
import { loadDotEnvFile } from './dotenv.js';

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

export function resolveConfigPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.SCRY_CONFIG) return resolve(process.env.SCRY_CONFIG);

  const cwdPath = resolve('scry.config.yaml');
  if (existsSync(cwdPath)) return cwdPath;

  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
    ? process.env.XDG_CONFIG_HOME
    : join(homedir(), '.config');
  return resolve(xdgConfigHome, 'scry', 'scry.config.yaml');
}

export function loadConfig(path?: string): ScryConfig {
  const configPath = resolveConfigPath(path);
  loadDotEnvFile(join(dirname(configPath), '.scry.env'));
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw);
  return resolveDeep(parsed) as ScryConfig;
}
