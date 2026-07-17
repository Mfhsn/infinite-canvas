import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { DreamProxyConfig } from './types.js';

const DREAM_API_PROXY_PATH = '/__dream_api_proxy';
const DREAM_MEDIA_PROXY_PATH = '/__dream_media_proxy';
const MAX_DREAM_MEDIA_BYTES = 100 * 1024 * 1024;

export async function handleDreamProxy(req: IncomingMessage, res: ServerResponse, config?: DreamProxyConfig): Promise<boolean> {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (requestUrl.pathname.startsWith(`${DREAM_API_PROXY_PATH}/`)) {
    await proxyDreamApi(req, res, requestUrl, config);
    return true;
  }
  if (requestUrl.pathname === DREAM_MEDIA_PROXY_PATH) {
    await proxyDreamMedia(req, res, requestUrl.searchParams.get('url') || '');
    return true;
  }
  return false;
}

async function proxyDreamApi(req: IncomingMessage, res: ServerResponse, requestUrl: URL, config?: DreamProxyConfig): Promise<void> {
  const upstream = parseDreamApiUrl(config?.baseUrl);
  if (!upstream) {
    sendProxyError(res, 503, 'Dream API proxy is not configured');
    return;
  }

  const tlsServerName = config?.tlsServerName.trim() || '';
  const useTls = upstream.protocol === 'https:' || Boolean(tlsServerName);
  const path = `${requestUrl.pathname.slice(DREAM_API_PROXY_PATH.length)}${requestUrl.search}`;
  const headers = proxyRequestHeaders(req.headers, tlsServerName || upstream.host);
  const options: https.RequestOptions = {
    hostname: upstream.hostname,
    port: Number(upstream.port) || (useTls ? 443 : 80),
    method: req.method,
    path,
    headers,
  };
  if (useTls) {
    options.rejectUnauthorized = true;
    if (tlsServerName) {
      options.servername = config?.disableSni ? '' : tlsServerName;
      options.checkServerIdentity = (_hostname, certificate) => tls.checkServerIdentity(tlsServerName, certificate);
    }
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const onResponse = (upstreamResponse: IncomingMessage) => {
      res.statusCode = upstreamResponse.statusCode || 502;
      copyResponseHeaders(upstreamResponse.headers, res);
      upstreamResponse.pipe(res);
      upstreamResponse.once('end', finish);
      upstreamResponse.once('error', (error) => {
        if (!res.headersSent) sendProxyError(res, 502, dreamProxyError(error));
        else res.destroy(error);
        finish();
      });
    };
    const proxyRequest = useTls ? https.request(options, onResponse) : http.request(options, onResponse);
    proxyRequest.setTimeout(config?.timeoutMs || 3 * 60 * 1000, () => proxyRequest.destroy(new Error('Dream API proxy timed out')));
    proxyRequest.once('error', (error) => {
      sendProxyError(res, 502, dreamProxyError(error));
      finish();
    });
    req.once('aborted', () => proxyRequest.destroy(new Error('Client request aborted')));
    req.pipe(proxyRequest);
  });
}

async function proxyDreamMedia(req: IncomingMessage, res: ServerResponse, target: string): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method not allowed');
    return;
  }
  if (!isAllowedDreamMedia(target)) {
    res.statusCode = 403;
    res.end('Dream media host is not allowed');
    return;
  }
  try {
    const upstream = await fetch(target, {
      headers: { Accept: 'image/*,video/*,audio/*,*/*;q=0.8' },
      redirect: 'manual',
    });
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.end('Dream media upstream request failed');
      return;
    }
    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > MAX_DREAM_MEDIA_BYTES) {
      res.statusCode = 413;
      res.end('Dream media file is too large');
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.byteLength > MAX_DREAM_MEDIA_BYTES) {
      res.statusCode = 413;
      res.end('Dream media file is too large');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Length', String(body.byteLength));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(body);
  } catch (error) {
    sendProxyError(res, 502, dreamProxyError(error));
  }
}

function parseDreamApiUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function proxyRequestHeaders(source: IncomingHttpHeaders, host: string): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...source, host, connection: 'close', 'accept-encoding': 'identity' };
  delete headers['proxy-connection'];
  return headers;
}

function copyResponseHeaders(headers: IncomingHttpHeaders, res: ServerResponse): void {
  for (const name of ['content-type', 'content-length', 'cache-control', 'content-disposition'] as const) {
    const value = headers[name];
    if (value !== undefined) res.setHeader(name, value);
  }
}

function isAllowedDreamMedia(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase().endsWith('.volces.com');
  } catch {
    return false;
  }
}

function dreamProxyError(error: unknown): string {
  const value = error as Error & { code?: string };
  const reason = value?.code || value?.message;
  return reason ? `Dream API connection failed (${reason})` : 'Dream API connection failed';
}

function sendProxyError(res: ServerResponse, status: number, detail: string): void {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify({ detail });
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.end(body);
}
