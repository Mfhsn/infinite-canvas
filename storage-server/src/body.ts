import type { IncomingMessage } from 'node:http';
import { HttpError } from './types.js';

export async function readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.byteLength;
    if (total > limit) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  const body = await readBuffer(req, limit);
  if (body.byteLength === 0) throw new HttpError(400, 'invalid_json', 'Request body must be JSON');
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}
