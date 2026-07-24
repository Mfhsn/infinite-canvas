import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, type IntegrationConfig, type IntegrationSessionRecord, type IntegrationSessionRepository, type PlatformContext } from './types.js';

export const SESSION_BINDING_HEADER = 'X-Canvas-Session-Binding';
export const SESSION_BINDING_QUERY = 'session_binding';
const ENCRYPTION_VERSION = 'v1';
type TokenKind = 'external' | 'refresh' | 'local';

export interface ActiveIntegrationSession {
  idHash: string;
  binding: string;
  context: PlatformContext;
  externalToken: string | null;
  refreshToken: string | null;
  localToken: string;
}

export class MemoryIntegrationSessionRepository implements IntegrationSessionRepository {
  private readonly records = new Map<string, IntegrationSessionRecord>();

  async get(sessionIdHash: string): Promise<IntegrationSessionRecord | null> {
    return this.records.get(sessionIdHash) ?? null;
  }

  async save(record: IntegrationSessionRecord): Promise<void> {
    this.records.set(record.sessionIdHash, structuredClone(record));
  }

  async updateExisting(record: IntegrationSessionRecord): Promise<boolean> {
    if (!this.records.has(record.sessionIdHash)) return false;
    this.records.set(record.sessionIdHash, structuredClone(record));
    return true;
  }

  async replace(sessionIdHash: string, replacement: IntegrationSessionRecord): Promise<boolean> {
    if (!this.records.has(sessionIdHash) || this.records.has(replacement.sessionIdHash)) return false;
    this.records.delete(sessionIdHash);
    this.records.set(replacement.sessionIdHash, structuredClone(replacement));
    return true;
  }

  async delete(sessionIdHash: string): Promise<void> {
    this.records.delete(sessionIdHash);
  }
}

export class IntegrationSessionService {
  private readonly encryptionKey: Buffer;

  constructor(private readonly config: IntegrationConfig, private readonly repository: IntegrationSessionRepository) {
    if (!config.sessionSecret) throw new Error('INTEGRATION_SESSION_SECRET is required when Integration is enabled');
    if (Buffer.byteLength(config.sessionSecret, 'utf8') < 32) throw new Error('INTEGRATION_SESSION_SECRET must be at least 32 UTF-8 bytes');
    this.encryptionKey = createHash('sha256').update('infinite-canvas:integration-session:v1\0').update(config.sessionSecret).digest();
  }

  async create(
    res: ServerResponse,
    context: PlatformContext,
    tokens: { externalToken?: string | null; refreshToken?: string | null; localToken: string },
  ): Promise<ActiveIntegrationSession> {
    assertIdentity(context);
    const sessionId = randomBytes(32).toString('base64url');
    const record = this.createRecord(sessionId, context, tokens);
    await this.repository.save(record);
    setSessionCookie(res, this.config, sessionId, this.config.sessionTtlSeconds);
    return this.decode(record);
  }

  async rotate(
    res: ServerResponse,
    current: ActiveIntegrationSession,
    context: PlatformContext,
    tokens: { externalToken?: string | null; refreshToken?: string | null; localToken: string },
  ): Promise<ActiveIntegrationSession> {
    assertIdentity(context);
    const sessionId = randomBytes(32).toString('base64url');
    const record = this.createRecord(sessionId, context, tokens);
    const replaced = await this.repository.replace(current.idHash, record);
    if (!replaced) throw new HttpError(409, 'session_rotation_conflict', 'Session was already rotated');
    setSessionCookie(res, this.config, sessionId, this.config.sessionTtlSeconds);
    return this.decode(record);
  }

  async resolve(req: IncomingMessage): Promise<ActiveIntegrationSession | null> {
    const sessionId = parseCookies(req.headers.cookie)[this.config.cookieName];
    if (!sessionId) return null;
    const idHash = hashSessionId(sessionId);
    const record = await this.repository.get(idHash);
    if (!record) return null;
    if (Date.parse(record.sessionExpiresAt) <= Date.now() || Date.parse(record.context.expiresAt) <= Date.now()) {
      await this.repository.delete(idHash);
      return null;
    }
    try {
      return this.decode(record);
    } catch {
      await this.repository.delete(idHash);
      return null;
    }
  }

  async updateContext(session: ActiveIntegrationSession, context: PlatformContext): Promise<ActiveIntegrationSession> {
    const current = await this.repository.get(session.idHash);
    if (!current) throw sessionRotated();
    try {
      assertIdentity(context);
    } catch (error) {
      await this.repository.delete(session.idHash);
      throw error;
    }
    if (identityTuple(current.context) !== identityTuple(context)) {
      await this.repository.delete(session.idHash);
      throw new HttpError(401, 'session_identity_changed', 'Platform session identity changed');
    }
    current.context = { ...context, expiresAt: earlierExpiry(context.expiresAt, current.sessionExpiresAt) };
    current.updatedAt = new Date().toISOString();
    if (!await this.repository.updateExisting(current)) throw sessionRotated();
    return this.decode(current);
  }

  async destroy(req: IncomingMessage, res: ServerResponse): Promise<ActiveIntegrationSession | null> {
    const active = await this.resolve(req);
    const sessionId = parseCookies(req.headers.cookie)[this.config.cookieName];
    if (sessionId) await this.repository.delete(hashSessionId(sessionId));
    clearSessionCookie(res, this.config);
    return active;
  }

  matchesBinding(session: ActiveIntegrationSession, supplied: string | undefined): boolean {
    if (!supplied) return false;
    const expected = Buffer.from(session.binding, 'utf8');
    const actual = Buffer.from(supplied, 'utf8');
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
  }

  private binding(sessionIdHash: string): string {
    return createHmac('sha256', this.config.sessionSecret)
      .update('infinite-canvas:session-binding:v1\0')
      .update(sessionIdHash)
      .digest('base64url');
  }

  private createRecord(
    sessionId: string,
    context: PlatformContext,
    tokens: { externalToken?: string | null; refreshToken?: string | null; localToken: string },
  ): IntegrationSessionRecord {
    const idHash = hashSessionId(sessionId);
    const now = new Date().toISOString();
    const sessionExpiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000).toISOString();
    return {
      sessionIdHash: idHash,
      context: { ...context, expiresAt: earlierExpiry(context.expiresAt, sessionExpiresAt) },
      externalTokenCiphertext: tokens.externalToken ? this.encrypt(tokens.externalToken, idHash, 'external') : null,
      refreshTokenCiphertext: tokens.refreshToken ? this.encrypt(tokens.refreshToken, idHash, 'refresh') : null,
      localTokenCiphertext: this.encrypt(tokens.localToken, idHash, 'local'),
      sessionExpiresAt,
      createdAt: now,
      updatedAt: now,
    };
  }

  private encrypt(value: string, sessionIdHash: string, tokenKind: TokenKind): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(tokenAad(sessionIdHash, tokenKind));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [ENCRYPTION_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  private decrypt(value: string, sessionIdHash: string, tokenKind: TokenKind): string {
    const [version, iv, tag, ciphertext] = value.split('.');
    if (version !== ENCRYPTION_VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Invalid encrypted session value');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAAD(tokenAad(sessionIdHash, tokenKind));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }

  private decode(record: IntegrationSessionRecord): ActiveIntegrationSession {
    assertIdentity(record.context);
    return {
      idHash: record.sessionIdHash,
      binding: this.binding(record.sessionIdHash),
      context: record.context,
      externalToken: record.externalTokenCiphertext ? this.decrypt(record.externalTokenCiphertext, record.sessionIdHash, 'external') : null,
      refreshToken: record.refreshTokenCiphertext ? this.decrypt(record.refreshTokenCiphertext, record.sessionIdHash, 'refresh') : null,
      localToken: this.decrypt(record.localTokenCiphertext, record.sessionIdHash, 'local'),
    };
  }
}

function sessionRotated(): HttpError {
  return new HttpError(401, 'session_rotated', 'Session was already rotated');
}

export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

export function deriveStorageNamespace(context: PlatformContext): string {
  assertIdentity(context);
  return createHash('sha256').update(identityTuple(context)).digest('hex');
}

function identityTuple(context: PlatformContext): string {
  return JSON.stringify([context.uid, context.sourceSystem, context.localProjectId]);
}

function assertIdentity(context: PlatformContext): void {
  if (typeof context.uid !== 'string' || !context.uid.trim()) throw new HttpError(502, 'invalid_integration_response', 'Platform response has invalid uid');
  if (typeof context.sourceSystem !== 'string' || !context.sourceSystem.trim()) throw new HttpError(502, 'invalid_integration_response', 'Platform response has invalid source system');
  if (!Number.isSafeInteger(context.localProjectId)) throw new HttpError(502, 'invalid_integration_response', 'Platform response has invalid local project context');
}

function tokenAad(sessionIdHash: string, tokenKind: TokenKind): Buffer {
  return Buffer.from(JSON.stringify([sessionIdHash, tokenKind, ENCRYPTION_VERSION]), 'utf8');
}

function earlierExpiry(first: string, second: string): string {
  const firstTime = Date.parse(first);
  return Number.isFinite(firstTime) && firstTime < Date.parse(second) ? new Date(firstTime).toISOString() : second;
}

function parseCookies(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of value?.split(';') ?? []) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    result[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return result;
}

function setSessionCookie(res: ServerResponse, config: IntegrationConfig, value: string, maxAge: number): void {
  const secure = config.cookieSecure ? '; Secure' : '';
  res.setHeader('set-cookie', `${config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(res: ServerResponse, config: IntegrationConfig): void {
  setSessionCookie(res, config, '', 0);
}
