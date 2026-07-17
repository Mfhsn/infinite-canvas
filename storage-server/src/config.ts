import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerConfig, StorageDriver } from './types.js';

const defaultStaticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) return fallback;
  return value;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name];
  return raw === '1' || raw?.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const requested = (env.DATA_STORAGE_DRIVER ?? 'browser').trim().toLowerCase();
  if (requested !== 'browser' && requested !== 'mysql') throw new Error('DATA_STORAGE_DRIVER must be browser or mysql');
  const driver: StorageDriver = requested;
  const maxFileMb = Number.parseInt(env.STORAGE_MAX_FILE_MB ?? '128', 10);
  const maxDocumentMb = Number.parseInt(env.STORAGE_MAX_DOCUMENT_MB ?? '16', 10);
  return {
    driver,
    namespace: env.STORAGE_NAMESPACE || 'default',
    port: Number.parseInt(env.STORAGE_API_PORT ?? env.PORT ?? '3001', 10) || 3001,
    staticDir: path.resolve(env.STATIC_DIR || defaultStaticDir),
    maxFileBytes: Math.max(1, Number.isFinite(maxFileMb) ? maxFileMb : 128) * 1024 * 1024,
    maxDocumentBytes: Math.max(1, Number.isFinite(maxDocumentMb) ? maxDocumentMb : 16) * 1024 * 1024,
    dreamProxy: {
      baseUrl: env.VITE_AI_BASE_URL?.trim() || '',
      tlsServerName: env.VITE_AI_TLS_SERVER_NAME?.trim() || '',
      disableSni: boolEnv(env, 'VITE_AI_TLS_DISABLE_SNI'),
      timeoutMs: intEnv(env, 'VITE_AI_PROXY_TIMEOUT_MS', 3 * 60 * 1000, 1000),
    },
    mysql: {
      host: env.MYSQL_HOST || '127.0.0.1',
      port: intEnv(env, 'MYSQL_PORT', 3306, 1),
      database: env.MYSQL_DATABASE || 'infinite_canvas',
      user: env.MYSQL_USER || 'root',
      password: env.MYSQL_PASSWORD || '',
      connectionLimit: intEnv(env, 'MYSQL_CONNECTION_LIMIT', 10, 1),
      connectAttempts: intEnv(env, 'MYSQL_CONNECT_ATTEMPTS', 30, 1),
      connectRetryMs: intEnv(env, 'MYSQL_CONNECT_RETRY_MS', 2000, 100),
      ssl: boolEnv(env, 'MYSQL_SSL'),
    },
  };
}
