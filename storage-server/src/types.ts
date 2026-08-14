export const allowedDomains = [
  'canvas',
  'canvas_folders',
  'assets',
  'image_generation_logs',
  'video_generation_logs',
] as const;

export type StorageDriver = 'browser' | 'mysql';
export type StorageDomain = (typeof allowedDomains)[number];

export interface DreamProxyConfig {
  baseUrl: string;
  tlsServerName: string;
  disableSni: boolean;
  timeoutMs: number;
}

export interface IntegrationConfig {
  enabled: boolean;
  baseUrl: string;
  tlsServerName: string;
  disableSni: boolean;
  externalProjectId: string;
  sourceSystem: string;
  sessionSecret: string;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface ServerConfig {
  driver: StorageDriver;
  namespace: string;
  port: number;
  staticDir: string;
  appBasePath: string;
  maxFileBytes: number;
  maxDocumentBytes: number;
  dreamProxy?: DreamProxyConfig;
  integration: IntegrationConfig;
  mysql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    connectionLimit: number;
    connectAttempts: number;
    connectRetryMs: number;
    ssl: boolean;
  };
}

export interface PlatformContext {
  authenticated: true;
  uid: string;
  username: string;
  nickname: string;
  permissionIds: number[];
  currentPoints: number | null;
  localProjectId: number | null;
  externalProjectId: string | null;
  sourceSystem: string;
  expiresAt: string;
}

export interface PlatformProject {
  projectId: string;
  name: string;
  points: number | null;
  permissionIds: number[];
}

export interface PlatformProjectCreateInput {
  name: string;
  content: string | null;
  tag: string;
  skill: number[];
  skillModel: string[];
}

export interface IntegrationSessionRecord {
  sessionIdHash: string;
  context: PlatformContext;
  externalTokenCiphertext: string | null;
  refreshTokenCiphertext: string | null;
  localTokenCiphertext: string;
  sessionExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationSessionRepository {
  get(sessionIdHash: string): Promise<IntegrationSessionRecord | null>;
  save(record: IntegrationSessionRecord): Promise<void>;
  updateExisting(record: IntegrationSessionRecord): Promise<boolean>;
  replace(sessionIdHash: string, replacement: IntegrationSessionRecord): Promise<boolean>;
  delete(sessionIdHash: string): Promise<void>;
}

export interface DocumentRecord {
  domain: StorageDomain;
  key: string;
  payload: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlobMetadata {
  key: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlobRecord extends BlobMetadata {
  content: Buffer;
}

export interface DocumentRepository {
  list(namespace: string, domain: StorageDomain): Promise<DocumentRecord[]>;
  get(namespace: string, domain: StorageDomain, key: string): Promise<DocumentRecord | null>;
  put(namespace: string, domain: StorageDomain, key: string, payload: unknown, expectedRevision?: number): Promise<DocumentRecord | 'conflict'>;
  delete(namespace: string, domain: StorageDomain, key: string, expectedRevision?: number): Promise<boolean | 'conflict'>;
  batch(
    namespace: string,
    domain: StorageDomain,
    puts: Array<{ key: string; payload: unknown; expectedRevision?: number | null }>,
    deletes: Array<{ key: string; expectedRevision?: number }>,
  ): Promise<{ documents: DocumentRecord[]; deleted: string[] } | 'conflict'>;
}

export interface BlobRepository {
  list(namespace: string): Promise<BlobMetadata[]>;
  getMetadata(namespace: string, key: string): Promise<BlobMetadata | null>;
  getContent(namespace: string, key: string, start?: number, end?: number): Promise<Buffer | null>;
  put(namespace: string, key: string, mimeType: string, content: Buffer): Promise<BlobMetadata>;
  delete(namespace: string, key: string): Promise<boolean>;
}

export interface StorageRepositories {
  documents: DocumentRepository;
  blobs: BlobRepository;
  health?: () => Promise<void>;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
