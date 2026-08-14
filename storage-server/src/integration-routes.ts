import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson } from './body.js';
import { normalizeExternalToken, type IntegrationClient } from './integration-client.js';
import { SESSION_BINDING_HEADER, type ActiveIntegrationSession, type IntegrationSessionService } from './integration-session.js';
import { methodNotAllowed, sendJson } from './http.js';
import { HttpError, type IntegrationConfig, type PlatformProjectCreateInput } from './types.js';

export interface IntegrationRuntime {
  config: IntegrationConfig;
  client: IntegrationClient;
  sessions: IntegrationSessionService;
}

export async function handleIntegrationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: IntegrationRuntime | undefined,
  enabled: boolean,
  maxBodyBytes: number,
): Promise<boolean> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!pathname.startsWith('/api/platform/')) return false;
  res.setHeader('cache-control', 'no-store');

  if (pathname === '/api/platform/config') {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
    sendJson(res, 200, { enabled });
    return true;
  }
  if (!runtime) {
    if (enabled) throw new HttpError(503, 'integration_unavailable', 'Platform integration is not ready');
    throw new HttpError(404, 'not_found', 'Platform integration is disabled');
  }

  if (pathname === '/api/platform/onboarding/projects/list') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    const body = objectBody(await readJson(req, maxBodyBytes));
    const externalToken = normalizeExternalToken(requiredInput(body.externalToken ?? body.external_token, 'externalToken'));
    if (!externalToken) throw new HttpError(400, 'invalid_request', 'externalToken is required');
    const projects = await invalidateOnUpstreamUnauthorized(req, res, runtime, () => runtime.client.listProjects(externalToken));
    sendJson(res, 200, { projects });
    return true;
  }

  if (pathname === '/api/platform/onboarding/projects/create') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    const body = objectBody(await readJson(req, maxBodyBytes));
    const externalToken = normalizeExternalToken(requiredInput(body.externalToken ?? body.external_token, 'externalToken'));
    if (!externalToken) throw new HttpError(400, 'invalid_request', 'externalToken is required');
    const input = parseProjectCreateInput(body);
    const previousProjects = await invalidateOnUpstreamUnauthorized(req, res, runtime, () => runtime.client.listProjects(externalToken));
    const createdProject = await invalidateOnUpstreamUnauthorized(req, res, runtime, () => runtime.client.createProject(externalToken, input));
    const projects = await invalidateOnUpstreamUnauthorized(req, res, runtime, () => runtime.client.listProjects(externalToken));
    const project = createdProject ?? resolveCreatedProject(previousProjects, projects, input.name);
    sendJson(res, 200, { project, projects });
    return true;
  }

  if (pathname === '/api/platform/session/bootstrap') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    const body = objectBody(await readJson(req, maxBodyBytes));
    const externalToken = normalizeExternalToken(requiredInput(body.externalToken ?? body.external_token, 'externalToken'));
    if (!externalToken) throw new HttpError(400, 'invalid_request', 'externalToken is required');
    const refreshToken = optionalInput(body.refreshToken ?? body.refresh_token, 'refreshToken');
    const externalProjectId = optionalInput(body.externalProjectId ?? body.external_project_id, 'externalProjectId');
    const current = await runtime.sessions.resolve(req);
    if (
      current
      && current.externalToken === externalToken
      && current.refreshToken === refreshToken
      && (!externalProjectId || current.context.externalProjectId === externalProjectId)
    ) {
      const context = await runtime.client.current(current.localToken, current.externalToken ?? undefined);
      const refreshed = await runtime.sessions.updateContext(current, context);
      sendJson(res, 200, refreshed.context, { [SESSION_BINDING_HEADER]: refreshed.binding });
      return true;
    }
    let result;
    let usedRequestedProject = Boolean(externalProjectId);
    try {
      result = await runtime.client.exchange(externalToken, externalProjectId ?? undefined);
    } catch (error) {
      // A host page may persist a local/stale project id. The Integration
      // exchange endpoint requires an accessible external project id, so the
      // initial SSO bootstrap gets one safe fallback through the documented
      // external-project list. Explicit project switching remains strict.
      if (externalProjectId && isRecoverableHostProjectError(error)) {
        usedRequestedProject = false;
        try {
          result = await runtime.client.exchange(externalToken);
        } catch (fallbackError) {
          if (fallbackError instanceof HttpError && fallbackError.status === 401) await runtime.sessions.destroy(req, res);
          throw fallbackError;
        }
      } else {
        if (error instanceof HttpError && error.status === 401) await runtime.sessions.destroy(req, res);
        throw error;
      }
    }
    if (usedRequestedProject && externalProjectId && result.context.externalProjectId !== externalProjectId) {
      throw new HttpError(502, 'invalid_integration_response', 'Platform selected a different project');
    }
    const session = current
      ? await runtime.sessions.rotate(res, current, result.context, { externalToken, refreshToken, localToken: result.localToken })
      : await runtime.sessions.create(res, result.context, { externalToken, refreshToken, localToken: result.localToken });
    sendJson(res, 200, session.context, { [SESSION_BINDING_HEADER]: session.binding });
    return true;
  }

  if (pathname === '/api/platform/session/clear') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    await runtime.sessions.destroy(req, res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/platform/auth/register') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    const body = objectBody(await readJson(req, maxBodyBytes));
    await runtime.client.register({
      username: requiredInput(body.username, 'username'),
      password: requiredInput(body.password, 'password'),
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/platform/auth/login') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    const body = objectBody(await readJson(req, maxBodyBytes));
    const username = requiredInput(body.username, 'username');
    const password = requiredInput(body.password, 'password');
    const result = await runtime.client.login(username, password);
    await runtime.sessions.destroy(req, res);
    const session = await runtime.sessions.create(res, result.context, result);
    sendJson(res, 200, session.context, { [SESSION_BINDING_HEADER]: session.binding });
    return true;
  }

  if (pathname === '/api/platform/context') {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
    const session = await requireSession(req, runtime.sessions);
    const suppliedBinding = headerValue(req, SESSION_BINDING_HEADER);
    if (suppliedBinding && !runtime.sessions.matchesBinding(session, suppliedBinding)) throw bindingMismatch();
    try {
      const current = await runtime.client.current(session.localToken, session.externalToken ?? undefined);
      const refreshed = await runtime.sessions.updateContext(session, current);
      sendJson(res, 200, refreshed.context, { [SESSION_BINDING_HEADER]: refreshed.binding });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401 && error.code !== 'session_rotated') {
        await runtime.sessions.destroy(req, res);
      }
      throw error;
    }
    return true;
  }

  if (pathname === '/api/platform/auth/logout') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    const current = await requireSession(req, runtime.sessions);
    requireMatchingBinding(req, runtime.sessions, current);
    if (current.externalToken) {
      try {
        await runtime.client.logout(current.externalToken);
      } catch {
        // Keep the local session so the user can retry upstream revocation. A
        // successful local-only response would falsely claim the external token
        // was invalidated and would discard the only encrypted retry credential.
        throw new HttpError(502, 'platform_logout_failed', 'Platform logout failed; please retry');
      }
    }
    await runtime.sessions.destroy(req, res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/platform/projects') {
    if (req.method === 'GET') {
      const session = await requireProjectSession(req, res, runtime);
      const projects = await invalidateOnUpstreamUnauthorized(req, res, runtime, () => runtime.client.listProjects(session.externalToken!));
      sendJson(res, 200, { projects });
      return true;
    }
    if (req.method === 'POST') {
      assertSameOriginPost(req);
      const session = await requireProjectSession(req, res, runtime);
      const input = parseProjectCreateInput(objectBody(await readJson(req, maxBodyBytes)));
      await invalidateOnUpstreamUnauthorized(req, res, runtime, () => runtime.client.createProject(session.externalToken!, input));
      const projects = await invalidateOnUpstreamUnauthorized(req, res, runtime, () => runtime.client.listProjects(session.externalToken!));
      sendJson(res, 200, { projects });
      return true;
    }
    return methodNotAllowed(res, 'GET, POST'), true;
  }

  const selectMatch = /^\/api\/platform\/projects\/([^/]+)\/select$/.exec(pathname);
  if (selectMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
    assertSameOriginPost(req);
    const session = await requireProjectSession(req, res, runtime);
    const projectId = decodeProjectId(selectMatch[1]);
    const result = await invalidateOnUpstreamUnauthorized(req, res, runtime, async () => {
      const projects = await runtime.client.listProjects(session.externalToken!);
      if (!projects.some((project) => project.projectId === projectId)) {
        throw new HttpError(404, 'platform_project_not_found', 'Platform project is not accessible');
      }
      return runtime.client.exchange(session.externalToken!, projectId);
    });
    if (result.context.uid !== session.context.uid || result.context.sourceSystem !== session.context.sourceSystem) {
      throw new HttpError(502, 'invalid_integration_response', 'Platform project selection changed session identity');
    }
    if (result.context.externalProjectId !== projectId) {
      throw new HttpError(502, 'invalid_integration_response', 'Platform selected a different project');
    }
    const rotated = await runtime.sessions.rotate(res, session, result.context, {
      externalToken: session.externalToken,
      refreshToken: session.refreshToken,
      localToken: result.localToken,
    });
    sendJson(res, 200, rotated.context, { [SESSION_BINDING_HEADER]: rotated.binding });
    return true;
  }

  throw new HttpError(404, 'not_found', 'Platform route not found');
}

function isRecoverableHostProjectError(error: unknown): boolean {
  return error instanceof HttpError
    && (error.status === 422 || error.code === 'integration_error');
}

async function requireProjectSession(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: IntegrationRuntime,
): Promise<ActiveIntegrationSession> {
  const session = await requireSession(req, runtime.sessions);
  requireMatchingBinding(req, runtime.sessions, session);
  if (!session.externalToken) {
    await runtime.sessions.destroy(req, res);
    throw new HttpError(401, 'platform_session_incomplete', 'Platform session is missing external credentials');
  }
  return session;
}

async function invalidateOnUpstreamUnauthorized<T>(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: IntegrationRuntime,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) await runtime.sessions.destroy(req, res);
    throw error;
  }
}

function parseProjectCreateInput(body: Record<string, unknown>): PlatformProjectCreateInput {
  const skill = integerArray(body.skill, 'skill', false);
  const skillModelValue = body.skillModel ?? body.skill_model;
  return {
    name: requiredInput(body.name, 'name'),
    content: nullableInput(body.content, 'content'),
    tag: requiredInput(body.tag, 'tag'),
    skill,
    skillModel: stringArray(skillModelValue, 'skillModel'),
  };
}

function resolveCreatedProject(before: Awaited<ReturnType<IntegrationClient['listProjects']>>, after: Awaited<ReturnType<IntegrationClient['listProjects']>>, name: string) {
  const previousIds = new Set(before.map((project) => project.projectId));
  const added = after.filter((project) => !previousIds.has(project.projectId));
  if (added.length === 1) return added[0];
  const normalizedName = name.trim();
  const matching = added.filter((project) => project.name === normalizedName);
  return matching.length === 1 ? matching[0] : null;
}

function integerArray(value: unknown, name: string, required: boolean): number[] {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, 'invalid_request', `${name} must be a non-empty array`);
    return [];
  }
  if (!Array.isArray(value) || (required && value.length === 0)) throw new HttpError(400, 'invalid_request', `${name} must be an array`);
  if (!value.every((item) => typeof item === 'number' && Number.isSafeInteger(item))) {
    throw new HttpError(400, 'invalid_request', `${name} must contain only integers`);
  }
  return value as number[];
}

function stringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid_request', `${name} must be an array`);
  const result = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (result.some((item) => !item)) throw new HttpError(400, 'invalid_request', `${name} must contain only non-empty strings`);
  return result;
}

function nullableInput(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_request', `${name} must be a string or null`);
  return value;
}

function decodeProjectId(value: string): string {
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded) throw new Error('empty project id');
    return decoded;
  } catch {
    throw new HttpError(400, 'invalid_request', 'projectId is invalid');
  }
}

export async function requireSession(req: IncomingMessage, sessions: IntegrationSessionService): Promise<NonNullable<Awaited<ReturnType<IntegrationSessionService['resolve']>>>> {
  const session = await sessions.resolve(req);
  if (!session) throw new HttpError(401, 'authentication_required', 'Authentication required');
  return session;
}

export function requireMatchingBinding(
  req: IncomingMessage,
  sessions: IntegrationSessionService,
  session: ActiveIntegrationSession,
  queryBinding?: string | null,
): void {
  const supplied = headerValue(req, SESSION_BINDING_HEADER) ?? queryBinding ?? undefined;
  if (!sessions.matchesBinding(session, supplied)) throw bindingMismatch();
}

function bindingMismatch(): HttpError {
  return new HttpError(403, 'session_binding_mismatch', 'Session binding does not match');
}

function assertSameOriginPost(req: IncomingMessage): void {
  const fetchSite = headerValue(req, 'sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'cross_site_request_rejected', 'Cross-site request rejected');
  }
  const origin = headerValue(req, 'origin');
  if (!origin) return;
  const host = headerValue(req, 'x-forwarded-host')?.split(',')[0]?.trim() || headerValue(req, 'host');
  if (!host) throw new HttpError(403, 'cross_site_request_rejected', 'Cross-site request rejected');
  const forwardedProto = headerValue(req, 'x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : (req.socket as typeof req.socket & { encrypted?: boolean }).encrypted ? 'https' : 'http';
  try {
    if (new URL(origin).origin !== `${protocol}://${host}`) throw new Error('origin mismatch');
  } catch {
    throw new HttpError(403, 'cross_site_request_rejected', 'Cross-site request rejected');
  }
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object');
  return value as Record<string, unknown>;
}

function requiredInput(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'invalid_request', `${name} is required`);
  return value;
}

function optionalInput(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_request', `${name} must be a string or null`);
  return value.trim() || null;
}
