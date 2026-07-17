import type { ServerResponse } from 'node:http';
import { HttpError } from './types.js';

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.byteLength),
    ...headers,
  });
  res.end(data);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    return;
  }
  console.error(error);
  sendJson(res, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
}

export function methodNotAllowed(res: ServerResponse, allow: string): void {
  sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed' } }, { allow });
}
