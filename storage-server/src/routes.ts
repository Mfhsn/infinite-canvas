import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBuffer, readJson } from './body.js';
import { methodNotAllowed, sendJson } from './http.js';
import { requireMatchingBinding, requireSession, type IntegrationRuntime } from './integration-routes.js';
import { deriveStorageNamespace, SESSION_BINDING_QUERY } from './integration-session.js';
import { HttpError, type ServerConfig, type StorageRepositories } from './types.js';
import { parseBlobKey, parseDomain, parseRecordKey, parseRecordKeyValue, parseRevision, safeJson } from './validation.js';

export interface RouteContext {
  config: ServerConfig;
  repos?: StorageRepositories;
  integration?: IntegrationRuntime;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object');
  return value as Record<string, unknown>;
}

function requireRepos(ctx: RouteContext): StorageRepositories {
  if (!ctx.repos) throw new HttpError(503, 'storage_unavailable', 'Server is running without server-side storage');
  return ctx.repos;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = splitPath(url.pathname);
  if (parts[0] !== 'api' || parts[1] !== 'storage') return false;

  if (parts.length === 3 && parts[2] === 'config') {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
    const authRequired = Boolean(ctx.config.integration?.enabled && ctx.config.driver === 'mysql');
    const authenticated = authRequired && ctx.integration ? Boolean(await ctx.integration.sessions.resolve(req)) : false;
    if (authRequired) res.setHeader('cache-control', 'no-store');
    sendJson(res, 200, authRequired
      ? { driver: ctx.config.driver, authRequired: true, authenticated }
      : { driver: ctx.config.driver, namespace: ctx.config.namespace });
    return true;
  }

  if (parts.length === 3 && parts[2] === 'health') {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
    try {
      await ctx.repos?.health?.();
    } catch {
      throw new HttpError(503, 'storage_unavailable', 'Storage database is unavailable');
    }
    sendJson(res, 200, ctx.config.integration?.enabled
      ? { ok: true, driver: ctx.config.driver }
      : { ok: true, driver: ctx.config.driver, namespace: ctx.config.namespace });
    return true;
  }

  if (parts[2] === 'documents') {
    await handleDocuments(req, res, ctx, parts, await requestNamespace(req, ctx));
    return true;
  }

  if (parts[2] === 'blobs') {
    await handleBlobs(req, res, ctx, parts, await requestNamespace(req, ctx, url.searchParams.get(SESSION_BINDING_QUERY)));
    return true;
  }

  throw new HttpError(404, 'not_found', 'API route not found');
}

async function requestNamespace(req: IncomingMessage, ctx: RouteContext, queryBinding?: string | null): Promise<string> {
  if (!ctx.config.integration?.enabled || ctx.config.driver !== 'mysql') return ctx.config.namespace;
  if (!ctx.integration) throw new HttpError(503, 'integration_unavailable', 'Platform integration is not ready');
  const session = await requireSession(req, ctx.integration.sessions);
  requireMatchingBinding(req, ctx.integration.sessions, session, queryBinding);
  return deriveStorageNamespace(session.context);
}

async function handleDocuments(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, parts: string[], namespace: string): Promise<void> {
  const repos = requireRepos(ctx);
  const domain = parseDomain(parts[3]);

  if (parts.length === 4) {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
    sendJson(res, 200, { documents: await repos.documents.list(namespace, domain) });
    return;
  }

  if (parts.length === 5 && parts[4] === 'batch') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
    const body = jsonObject(await readJson(req, ctx.config.maxDocumentBytes));
    const rawPuts = Array.isArray(body.puts) ? body.puts : [];
    const rawDeletes = Array.isArray(body.deletes) ? body.deletes : [];
    if (rawPuts.length + rawDeletes.length > 5000) throw new HttpError(413, 'batch_too_large', 'Document batch is too large');
    const puts = rawPuts.map((value) => {
      const item = jsonObject(value);
      return { key: parseRecordKeyValue(item.key), payload: safeJson(item.payload), expectedRevision: item.revision === null ? null : parseRevision(item.revision) };
    });
    const deletes = rawDeletes.map((value) => {
      const item = jsonObject(value);
      return { key: parseRecordKeyValue(item.key), expectedRevision: parseRevision(item.revision) };
    });
    const result = await repos.documents.batch(namespace, domain, puts, deletes);
    if (result === 'conflict') throw new HttpError(409, 'revision_conflict', 'Document revision conflict');
    sendJson(res, 200, result);
    return;
  }

  if (parts.length !== 5) throw new HttpError(404, 'not_found', 'Document route not found');
  const key = parseRecordKey(parts[4]);

  if (req.method === 'GET') {
    const record = await repos.documents.get(namespace, domain, key);
    if (!record) throw new HttpError(404, 'not_found', 'Document not found');
    sendJson(res, 200, { document: record });
    return;
  }

  if (req.method === 'PUT') {
    const body = jsonObject(await readJson(req, ctx.config.maxDocumentBytes));
    const payload = safeJson(body.payload);
    const result = await repos.documents.put(namespace, domain, key, payload, parseRevision(body.revision));
    if (result === 'conflict') throw new HttpError(409, 'revision_conflict', 'Document revision conflict');
    sendJson(res, 200, { document: result });
    return;
  }

  if (req.method === 'DELETE') {
    const deleted = await repos.documents.delete(namespace, domain, key, parseIfMatch(req.headers['if-match']));
    if (deleted === 'conflict') throw new HttpError(409, 'revision_conflict', 'Document revision conflict');
    sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true } : { error: { code: 'not_found', message: 'Document not found' } });
    return;
  }

  methodNotAllowed(res, 'GET, PUT, DELETE');
}

function parseIfMatch(value: string | string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const revision = Number(normalized);
  return parseRevision(revision);
}

async function handleBlobs(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, parts: string[], namespace: string): Promise<void> {
  const repos = requireRepos(ctx);

  if (parts.length === 3) {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
    sendJson(res, 200, { blobs: await repos.blobs.list(namespace) });
    return;
  }

  if (parts.length !== 4) throw new HttpError(404, 'not_found', 'Blob route not found');
  const key = parseBlobKey(parts[3]);

  if (req.method === 'PUT') {
    const content = await readBuffer(req, ctx.config.maxFileBytes);
    const mimeType = req.headers['content-type']?.split(';')[0]?.trim() || 'application/octet-stream';
    const blob = await repos.blobs.put(namespace, key, mimeType, content);
    sendJson(res, 200, { blob });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const metadata = await repos.blobs.getMetadata(namespace, key);
    if (!metadata) throw new HttpError(404, 'not_found', 'Blob not found');
    const range = parseRange(req.headers.range, metadata.byteSize);
    const start = range?.start ?? 0;
    const end = range?.end ?? metadata.byteSize - 1;
    const status = range ? 206 : 200;
    const content = req.method === 'HEAD' ? null : await repos.blobs.getContent(namespace, key, range?.start, range?.end);
    if (req.method !== 'HEAD' && !content) throw new HttpError(404, 'not_found', 'Blob not found');
    res.writeHead(status, {
      'content-type': metadata.mimeType,
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${metadata.byteSize}` } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(content);
    return;
  }

  if (req.method === 'DELETE') {
    const deleted = await repos.blobs.delete(namespace, key);
    sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true } : { error: { code: 'not_found', message: 'Blob not found' } });
    return;
  }

  methodNotAllowed(res, 'GET, HEAD, PUT, DELETE');
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) throw new HttpError(416, 'invalid_range', 'Invalid range');
  if (!match[1] && !match[2]) throw new HttpError(416, 'invalid_range', 'Invalid range');
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number.parseInt(match[2], 10);
    if (suffix <= 0) throw new HttpError(416, 'invalid_range', 'Invalid range');
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    throw new HttpError(416, 'invalid_range', 'Invalid range');
  }
  return { start, end: Math.min(end, size - 1) };
}
