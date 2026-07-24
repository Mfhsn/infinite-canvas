import type { IntegrationConfig, PlatformContext, PlatformProject, PlatformProjectCreateInput } from './types.js';
import { HttpError } from './types.js';
import { requestUpstream } from './upstream-transport.js';

export interface IntegrationExchangeResult {
  context: PlatformContext;
  localToken: string;
}

export interface IntegrationLoginResult extends IntegrationExchangeResult {
  externalToken: string;
  refreshToken: string | null;
}

export interface IntegrationClient {
  register(input: { username: string; password: string }): Promise<void>;
  login(username: string, password: string): Promise<IntegrationLoginResult>;
  listProjects(externalToken: string): Promise<PlatformProject[]>;
  createProject(externalToken: string, input: PlatformProjectCreateInput): Promise<PlatformProject | null>;
  exchange(externalToken: string, externalProjectId?: string): Promise<IntegrationExchangeResult>;
  current(localToken: string): Promise<PlatformContext>;
  logout(externalToken: string): Promise<void>;
}

export class HttpIntegrationClient implements IntegrationClient {
  constructor(private readonly config: IntegrationConfig) {}

  async register(input: { username: string; password: string }): Promise<void> {
    await this.requestValue('POST', '/api/integration/external/auth/register', input);
  }

  async login(username: string, password: string): Promise<IntegrationLoginResult> {
    const login = await this.requestObject('POST', '/api/integration/external/auth/login', { username, password });
    const externalToken = normalizeExternalToken(requiredString(login, ['external_token', 'externalToken', 'token'], 'external token'));
    const refreshToken = optionalString(login, ['refresh_token', 'refreshToken']);
    const exchanged = await this.exchange(externalToken);
    return { ...exchanged, externalToken, refreshToken };
  }

  async listProjects(externalToken: string): Promise<PlatformProject[]> {
    const token = normalizeExternalToken(externalToken);
    const value = await this.requestValue('GET', '/api/integration/external/projects', undefined, {
      'x-external-token': token,
    });
    if (!Array.isArray(value)) throw new HttpError(502, 'invalid_integration_response', 'Platform returned an invalid project list');
    return value.map(parsePlatformProject);
  }

  async createProject(externalToken: string, input: PlatformProjectCreateInput): Promise<PlatformProject | null> {
    const token = normalizeExternalToken(externalToken);
    const value = await this.requestValue('POST', '/api/integration/external/projects/create', {
      name: input.name,
      content: input.content,
      tag: input.tag,
      skill: input.skill,
      skill_model: input.skillModel,
      points: 0,
    }, { 'x-external-token': token });
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(502, 'invalid_integration_response', 'Platform returned an invalid project');
    }
    return parsePlatformProject(value as Record<string, unknown>);
  }

  async exchange(externalToken: string, requestedProjectId?: string): Promise<IntegrationExchangeResult> {
    const token = normalizeExternalToken(externalToken);
    const externalProjectId = requestedProjectId?.trim()
      || this.config.externalProjectId
      || await this.resolveExternalProjectId(token);
    const value = await this.requestObject('POST', '/api/integration/session/exchange', {
      external_token: token,
      external_project_id: externalProjectId,
    }, {
      'x-external-token': token,
      authorization: `Bearer ${token}`,
    });
    try {
      return {
        localToken: normalizeBearerToken(requiredString(value, ['local_token', 'localToken'], 'local token')),
        context: parsePlatformContext(value, this.config),
      };
    } catch (error) {
      console.error('[integration] exchange response validation failed', {
        keys: responseShape(value),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async current(localToken: string): Promise<PlatformContext> {
    const value = await this.requestObject('GET', '/api/integration/context/current', undefined, { authorization: `Bearer ${localToken}` });
    return parsePlatformContext(value, this.config);
  }

  async logout(externalToken: string): Promise<void> {
    await this.requestValue('POST', '/api/integration/external/auth/logout', {}, { 'x-external-token': normalizeExternalToken(externalToken) });
  }

  private async resolveExternalProjectId(externalToken: string): Promise<string> {
    if (this.config.externalProjectId) return this.config.externalProjectId;
    const projects = await this.listProjects(externalToken);
    const projectId = projects[0]?.projectId;
    if (projectId) return projectId;
    throw new HttpError(403, 'platform_project_unavailable', 'No accessible platform project is available');
  }

  private async requestObject(method: string, path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const value = await this.requestValue(method, path, body, headers);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(502, 'invalid_integration_response', 'Platform returned an invalid response');
    }
    return value as Record<string, unknown>;
  }

  private async requestValue(method: string, path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<unknown> {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    let response;
    try {
      response = await requestUpstream({
        baseUrl: this.config.baseUrl,
        tlsServerName: this.config.tlsServerName,
        disableSni: this.config.disableSni,
        connectTimeoutMs: this.config.connectTimeoutMs,
        requestTimeoutMs: this.config.requestTimeoutMs,
      }, {
        method,
        path,
        body: encoded,
        headers: {
          accept: 'application/json',
          ...(encoded ? { 'content-type': 'application/json', 'content-length': String(encoded.byteLength) } : {}),
          ...headers,
        },
      });
    } catch (error) {
      console.error('[integration] upstream request failed', {
        method,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpError(502, 'integration_unavailable', 'Platform service is unavailable');
    }
    if (response.status < 200 || response.status >= 300) {
      const status = [401, 403, 422, 429].includes(response.status) ? response.status : 502;
      const code = status === 401
        ? 'invalid_credentials'
        : status === 403
          ? 'platform_forbidden'
          : status === 422
            ? 'platform_validation_failed'
            : status === 429
              ? 'rate_limited'
              : 'integration_error';
      const baseMessage = status === 401
        ? 'Platform authentication failed'
        : status === 403
          ? 'Platform permission denied'
          : status === 422
            ? 'Platform rejected the request'
            : `Platform request failed (upstream ${response.status})`;
      const detail = summarizeUpstreamError(response.body);
      console.error('[integration] upstream response rejected', {
        method,
        path,
        status: response.status,
        contentType: response.headers['content-type'],
        body: responseBodyShape(response.body),
        detail: detail || undefined,
      });
      throw new HttpError(status, code, detail ? `${baseMessage}: ${detail}` : baseMessage);
    }
    if (!response.body.length) return {};
    try {
      return unwrapValue(JSON.parse(response.body.toString('utf8')));
    } catch {
      throw new HttpError(502, 'invalid_integration_response', 'Platform returned an invalid response');
    }
  }
}

function responseBodyShape(body: Buffer): unknown {
  if (!body.length) return { type: 'empty', bytes: 0 };
  try {
    return { bytes: body.byteLength, value: responseShape(JSON.parse(body.toString('utf8'))) };
  } catch {
    return { type: 'non-json', bytes: body.byteLength };
  }
}

export function normalizeExternalToken(value: string): string {
  return normalizeBearerToken(value);
}

export function normalizeBearerToken(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, '').trim();
}

function summarizeUpstreamError(body: Buffer): string | null {
  if (!body.length) return null;
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const detail = record.detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const itemRecord = item as Record<string, unknown>;
      const location = Array.isArray(itemRecord.loc) ? itemRecord.loc.map(String).join('.') : '';
      const message = typeof itemRecord.msg === 'string' ? itemRecord.msg.trim() : '';
      return message ? [location ? `${location}: ${message}` : message] : [];
    });
    return messages.length ? messages.slice(0, 3).join('; ') : null;
  }
  // Do not forward arbitrary upstream messages: some platforms echo request
  // values in them. Structured validation locations/messages are the only
  // diagnostic detail safe enough to return to the browser.
  return null;
}

function parsePlatformProject(value: Record<string, unknown>): PlatformProject {
  const projectId = requiredString(value, ['project_id', 'projectId', 'id'], 'project id');
  const name = optionalString(value, ['name', 'project_name', 'projectName']) ?? projectId;
  const pointsValue = first(value, ['points', 'current_points', 'currentPoints']);
  const permissionValue = first(value, ['permission_ids', 'permissionIds', 'permission', 'permissions']);
  const permissionIds = Array.isArray(permissionValue)
    ? permissionValue
      .map((item) => typeof item === 'object' && item ? first(item as Record<string, unknown>, ['id', 'permission_id']) : item)
      .filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item))
    : [];
  return {
    projectId,
    name,
    points: projectPoints(pointsValue),
    permissionIds,
  };
}

function projectPoints(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(502, 'invalid_integration_response', 'Platform response has invalid project points');
  }
  return value;
}

function unwrapValue(input: unknown): unknown {
  let value = input;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) break;
    const record = value as Record<string, unknown>;
    let nested: unknown;
    if (Object.prototype.hasOwnProperty.call(record, 'data')) {
      nested = record.data;
    } else if (Object.prototype.hasOwnProperty.call(record, 'result')) {
      nested = record.result;
    } else {
      break;
    }
    if (nested === undefined || nested === value) break;
    value = nested;
  }
  return value;
}

function responseShape(value: unknown): unknown {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (!value || typeof value !== 'object') return { type: value === null ? 'null' : typeof value };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, Array.isArray(item)
    ? `array(${item.length})`
    : item === null
      ? 'null'
      : typeof item === 'object'
        ? `object(${Object.keys(item as Record<string, unknown>).join(',')})`
        : typeof item]));
}

export function parsePlatformContext(value: Record<string, unknown>, config: IntegrationConfig): PlatformContext {
  const profile = nestedObject(value, ['profile', 'user']);
  const project = nestedObject(value, ['project', 'context']);
  const permissionValue = firstAcross([value, project, profile], ['permission_ids', 'permissionIds', 'permission', 'permissions']);
  const permissionIds = Array.isArray(permissionValue)
    ? permissionValue.map((item) => typeof item === 'object' && item ? first(item as Record<string, unknown>, ['id', 'permission_id']) : item).map(Number).filter(Number.isSafeInteger)
    : [];
  const points = firstAcross([value, profile, project], ['current_points', 'currentPoints', 'points']);
  const localProjectId = Number(
    first(value, ['local_project_id', 'localProjectId'])
    ?? first(project, ['local_project_id', 'localProjectId', 'id']),
  );
  if (!Number.isSafeInteger(localProjectId)) throw new HttpError(502, 'invalid_integration_response', 'Platform response is missing local project context');
  return {
    authenticated: true,
    // Project/context objects may also contain a generic `id`. Never merge those
    // objects before resolving the user identity or project IDs can become uid.
    uid: requiredStringAcross([
      { value, keys: ['uid', 'user_id'] },
      { value: profile, keys: ['uid', 'user_id', 'id'] },
    ], 'uid'),
    username: requiredStringAcross([
      { value, keys: ['username', 'user_name'] },
      { value: profile, keys: ['username', 'user_name'] },
    ], 'username'),
    nickname: optionalStringAcross([
      { value, keys: ['nickname', 'display_name', 'name'] },
      { value: profile, keys: ['nickname', 'display_name', 'name'] },
    ]) || requiredStringAcross([
      { value, keys: ['username', 'user_name'] },
      { value: profile, keys: ['username', 'user_name'] },
    ], 'username'),
    permissionIds,
    currentPoints: points === null || points === undefined || points === '' ? null : finiteNumber(points, 'current points'),
    localProjectId,
    externalProjectId: optionalStringAcross([
      { value, keys: ['external_project_id', 'externalProjectId', 'project_id'] },
      { value: project, keys: ['external_project_id', 'externalProjectId', 'project_id'] },
    ]),
    sourceSystem: requiredSourceSystem([value, project], config),
    expiresAt: parseExpiry(firstAcross([value, project], ['expires_at', 'expiresAt', 'local_token_expires_at']), config.sessionTtlSeconds),
  };
}

function requiredSourceSystem(values: Record<string, unknown>[], config: IntegrationConfig): string {
  const sourceSystem = nullableString(firstAcross(values, ['source_system', 'sourceSystem'])) ?? config.sourceSystem.trim();
  if (!sourceSystem) throw new HttpError(502, 'invalid_integration_response', 'Platform response is missing source system');
  return sourceSystem;
}

function nestedObject(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const nested = first(value, keys);
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : {};
}

function first(value: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (value[key] !== undefined) return value[key];
  return undefined;
}

function firstAcross(values: Record<string, unknown>[], keys: string[]): unknown {
  for (const value of values) {
    const result = first(value, keys);
    if (result !== undefined) return result;
  }
  return undefined;
}

function requiredStringAcross(sources: Array<{ value: Record<string, unknown>; keys: string[] }>, label: string): string {
  const result = optionalStringAcross(sources);
  if (!result) throw new HttpError(502, 'invalid_integration_response', `Platform response is missing ${label}`);
  return result;
}

function optionalStringAcross(sources: Array<{ value: Record<string, unknown>; keys: string[] }>): string | null {
  for (const source of sources) {
    const result = optionalString(source.value, source.keys);
    if (result) return result;
  }
  return null;
}

function requiredString(value: Record<string, unknown>, keys: string[], label: string): string {
  const result = optionalString(value, keys);
  if (!result) throw new HttpError(502, 'invalid_integration_response', `Platform response is missing ${label}`);
  return result;
}

function optionalString(value: Record<string, unknown>, keys: string[]): string | null {
  return nullableString(first(value, keys));
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new HttpError(502, 'invalid_integration_response', `Platform response has invalid ${label}`);
  return number;
}

function parseExpiry(value: unknown, ttlSeconds: number): string {
  if (typeof value === 'number') {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString();
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}
