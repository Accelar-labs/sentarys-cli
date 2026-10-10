import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoredConfig {
  apiKey?: string;
  apiUrl?: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sentarys');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json');
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): StoredConfig {
  const path = configPath(env);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredConfig;
  } catch {
    return {};
  }
}

/** Writes the config readable only by the current user (the key acts as the account). */
export function writeConfig(config: StoredConfig, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configPath(env);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function clearConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const path = configPath(env);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

export const DEFAULT_API_URL = 'https://api.sentarys.com/v1';

export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): { apiKey?: string; apiUrl: string; source: 'env' | 'config' | 'none' } {
  const stored = readConfig(env);
  const apiUrl = (env.SENTARYS_API_URL || stored.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
  if (env.SENTARYS_API_KEY) return { apiKey: env.SENTARYS_API_KEY.trim(), apiUrl, source: 'env' };
  if (stored.apiKey) return { apiKey: stored.apiKey, apiUrl, source: 'config' };
  return { apiUrl, source: 'none' };
}

/** snt_live_abcd...wxyz, for messages; never print a whole key. */
export function maskKey(key: string): string {
  return key.length <= 16 ? `${key.slice(0, 4)}...` : `${key.slice(0, 13)}...${key.slice(-4)}`;
}
