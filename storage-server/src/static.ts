import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './types.js';

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function serveStatic(req: IncomingMessage, res: ServerResponse, staticDir: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'API route not found');
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');

  const root = path.resolve(staticDir);
  const decoded = decodeURIComponent(url.pathname);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const requested = safeResolve(root, relative);
  const filePath = await resolveFile(requested, root);
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    'content-type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': String(data.byteLength),
    'x-content-type-options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

function safeResolve(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new HttpError(403, 'forbidden', 'Forbidden');
  return resolved;
}

async function resolveFile(requested: string, root: string): Promise<string> {
  try {
    const stat = await fs.stat(requested);
    if (stat.isFile()) return requested;
  } catch {
    // fall through to SPA fallback
  }
  const index = safeResolve(root, 'index.html');
  try {
    const stat = await fs.stat(index);
    if (stat.isFile()) return index;
  } catch {
    // no static app was built/copied yet
  }
  throw new HttpError(404, 'not_found', 'Static file not found');
}
