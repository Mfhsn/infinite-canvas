import { allowedDomains, HttpError, type StorageDomain } from './types.js';

const keyPattern = /^[A-Za-z0-9._~!$&'()+,;=:@/-]+$/;
const namespacePattern = /^[A-Za-z0-9._-]{1,128}$/;

export function assertNamespace(value: string): string {
  if (!namespacePattern.test(value)) throw new HttpError(500, 'invalid_namespace', 'Invalid storage namespace');
  return value;
}

export function parseDomain(value: string | undefined): StorageDomain {
  if (!value) throw new HttpError(400, 'missing_domain', 'Missing storage domain');
  const decoded = decodePathPart(value, 'domain');
  if ((allowedDomains as readonly string[]).includes(decoded)) return decoded as StorageDomain;
  throw new HttpError(400, 'invalid_domain', 'Invalid storage domain');
}

export function parseRecordKey(value: string | undefined): string {
  return parseRecordKeyValue(decodePathPart(value, 'key'));
}

export function parseRecordKeyValue(value: unknown): string {
  const key = typeof value === 'string' ? value : '';
  if (key.length > 0 && key.length <= 512 && !key.includes('\0') && !key.includes('..') && !key.includes('/') && !key.includes('\\')) return key;
  throw new HttpError(400, 'invalid_key', 'Invalid record key');
}

export function parseBlobKey(value: string | undefined): string {
  const key = decodePathPart(value, 'key');
  if (key.length > 0 && key.length <= 512 && keyPattern.test(key) && !key.includes('..') && !key.startsWith('/')) return key;
  throw new HttpError(400, 'invalid_key', 'Invalid blob key');
}

export function parseRevision(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HttpError(400, 'invalid_revision', 'revision must be a positive integer');
  }
  return value;
}

export function decodePathPart(value: string | undefined, name: string): string {
  if (!value) throw new HttpError(400, `missing_${name}`, `Missing ${name}`);
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes('/') || decoded.includes('\\')) throw new Error('slash');
    return decoded;
  } catch {
    throw new HttpError(400, `invalid_${name}`, `Invalid ${name}`);
  }
}

export function safeJson(value: unknown): unknown {
  if (value === undefined) throw new HttpError(400, 'invalid_payload', 'payload is required');
  JSON.stringify(value);
  return value;
}
