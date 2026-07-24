import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export interface UpstreamTransportOptions {
  baseUrl: string;
  tlsServerName?: string;
  disableSni?: boolean;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface UpstreamResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export function upstreamRequestOptions(
  config: Pick<UpstreamTransportOptions, 'baseUrl' | 'tlsServerName' | 'disableSni'>,
  request: { method?: string; path: string; headers?: http.OutgoingHttpHeaders },
): { useTls: boolean; options: https.RequestOptions } {
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Upstream URL must use http or https');
  const useTls = base.protocol === 'https:';
  const tlsServerName = config.tlsServerName?.trim() || '';
  const prefix = base.pathname.replace(/\/$/, '');
  const options: https.RequestOptions = {
    hostname: base.hostname,
    port: Number(base.port) || (useTls ? 443 : 80),
    method: request.method,
    path: `${prefix}${request.path}`,
    headers: { host: tlsServerName || base.host, connection: 'close', ...request.headers },
  };
  if (useTls) {
    options.rejectUnauthorized = true;
    if (tlsServerName) {
      options.servername = config.disableSni ? '' : tlsServerName;
      options.checkServerIdentity = (_hostname, certificate) => tls.checkServerIdentity(tlsServerName, certificate);
    }
  }
  return { useTls, options };
}

export async function requestUpstream(
  config: UpstreamTransportOptions,
  request: { method: string; path: string; headers?: http.OutgoingHttpHeaders; body?: Buffer },
): Promise<UpstreamResponse> {
  const { useTls, options } = upstreamRequestOptions(config, request);

  return new Promise<UpstreamResponse>((resolve, reject) => {
    let connected = false;
    const client = (useTls ? https : http).request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode || 502, headers: response.headers, body: Buffer.concat(chunks) }));
      response.once('error', reject);
    });
    const connectTimer = setTimeout(() => {
      if (!connected) client.destroy(new Error('Upstream connection timed out'));
    }, config.connectTimeoutMs);
    client.once('socket', (socket) => {
      const event = useTls ? 'secureConnect' : 'connect';
      socket.once(event, () => {
        connected = true;
        clearTimeout(connectTimer);
      });
    });
    client.setTimeout(config.requestTimeoutMs, () => client.destroy(new Error('Upstream request timed out')));
    client.once('error', (error) => {
      clearTimeout(connectTimer);
      reject(error);
    });
    if (request.body) client.write(request.body);
    client.end();
  });
}
