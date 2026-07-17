import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import type { BlobMetadata, BlobRepository, DocumentRecord, DocumentRepository, ServerConfig, StorageDomain, StorageRepositories } from './types.js';

interface DocumentRow extends RowDataPacket {
  domain: StorageDomain;
  record_key: string;
  payload: unknown;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface BlobMetaRow extends RowDataPacket {
  storage_key: string;
  mime_type: string;
  byte_size: number;
  created_at: Date;
  updated_at: Date;
}

interface BlobContentRow extends RowDataPacket {
  content: Buffer;
}

function dateIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function documentFromRow(row: DocumentRow): DocumentRecord {
  return {
    domain: row.domain,
    key: row.record_key,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    revision: Number(row.revision),
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
  };
}

function blobMetaFromRow(row: BlobMetaRow): BlobMetadata {
  return {
    key: row.storage_key,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
  };
}

export async function createMysqlPool(config: ServerConfig): Promise<Pool> {
  const pool = mysql.createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    database: config.mysql.database,
    user: config.mysql.user,
    password: config.mysql.password,
    connectionLimit: config.mysql.connectionLimit,
    charset: 'utf8mb4',
    ssl: config.mysql.ssl ? {} : undefined,
    namedPlaceholders: false,
  });
  for (let attempt = 1; attempt <= config.mysql.connectAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (error) {
      if (attempt === config.mysql.connectAttempts) {
        await pool.end();
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, config.mysql.connectRetryMs));
    }
  }
  await migrate(pool);
  return pool;
}

export async function migrate(pool: Pool): Promise<void> {
  const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '001_init.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  await pool.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', ['001_init']);
}

export class MysqlDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async list(namespace: string, domain: StorageDomain): Promise<DocumentRecord[]> {
    const [rows] = await this.pool.query<DocumentRow[]>(
      'SELECT domain, record_key, payload, revision, created_at, updated_at FROM storage_documents WHERE namespace = ? AND domain = ? ORDER BY record_key',
      [namespace, domain],
    );
    return rows.map(documentFromRow);
  }

  async get(namespace: string, domain: StorageDomain, key: string): Promise<DocumentRecord | null> {
    const [rows] = await this.pool.query<DocumentRow[]>(
      'SELECT domain, record_key, payload, revision, created_at, updated_at FROM storage_documents WHERE namespace = ? AND domain = ? AND record_key = ? LIMIT 1',
      [namespace, domain, key],
    );
    return rows[0] ? documentFromRow(rows[0]) : null;
  }

  async put(namespace: string, domain: StorageDomain, key: string, payload: unknown, expectedRevision?: number): Promise<DocumentRecord | 'conflict'> {
    const encoded = JSON.stringify(payload);
    if (expectedRevision === undefined) {
      await this.pool.query<ResultSetHeader>(
        `INSERT INTO storage_documents (namespace, domain, record_key, payload, revision)
         VALUES (?, ?, ?, CAST(? AS JSON), 1)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3)`,
        [namespace, domain, key, encoded],
      );
    } else {
      const [result] = await this.pool.query<ResultSetHeader>(
        'UPDATE storage_documents SET payload = CAST(? AS JSON), revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE namespace = ? AND domain = ? AND record_key = ? AND revision = ?',
        [encoded, namespace, domain, key, expectedRevision],
      );
      if (result.affectedRows === 0) return 'conflict';
    }
    const saved = await this.get(namespace, domain, key);
    if (!saved) return 'conflict';
    return saved;
  }

  async delete(namespace: string, domain: StorageDomain, key: string, expectedRevision?: number): Promise<boolean | 'conflict'> {
    const [result] = expectedRevision === undefined
      ? await this.pool.query<ResultSetHeader>('DELETE FROM storage_documents WHERE namespace = ? AND domain = ? AND record_key = ?', [namespace, domain, key])
      : await this.pool.query<ResultSetHeader>('DELETE FROM storage_documents WHERE namespace = ? AND domain = ? AND record_key = ? AND revision = ?', [namespace, domain, key, expectedRevision]);
    if (expectedRevision !== undefined && result.affectedRows === 0) {
      const current = await this.get(namespace, domain, key);
      return current ? 'conflict' : false;
    }
    return result.affectedRows > 0;
  }

  async batch(
    namespace: string,
    domain: StorageDomain,
    puts: Array<{ key: string; payload: unknown; expectedRevision?: number | null }>,
    deletes: Array<{ key: string; expectedRevision?: number }>,
  ): Promise<{ documents: DocumentRecord[]; deleted: string[] } | 'conflict'> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const deleted: string[] = [];
      for (const item of deletes) {
        const [result] = item.expectedRevision === undefined
          ? await connection.query<ResultSetHeader>('DELETE FROM storage_documents WHERE namespace = ? AND domain = ? AND record_key = ?', [namespace, domain, item.key])
          : await connection.query<ResultSetHeader>('DELETE FROM storage_documents WHERE namespace = ? AND domain = ? AND record_key = ? AND revision = ?', [namespace, domain, item.key, item.expectedRevision]);
        if (item.expectedRevision !== undefined && result.affectedRows === 0) {
          const [rows] = await connection.query<RowDataPacket[]>('SELECT revision FROM storage_documents WHERE namespace = ? AND domain = ? AND record_key = ? LIMIT 1', [namespace, domain, item.key]);
          if (rows.length) {
            await connection.rollback();
            return 'conflict';
          }
        }
        if (result.affectedRows) deleted.push(item.key);
      }

      for (const item of puts) {
        const encoded = JSON.stringify(item.payload);
        if (item.expectedRevision === null) {
          try {
            await connection.query<ResultSetHeader>(
              'INSERT INTO storage_documents (namespace, domain, record_key, payload, revision) VALUES (?, ?, ?, CAST(? AS JSON), 1)',
              [namespace, domain, item.key, encoded],
            );
          } catch (error) {
            if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
              await connection.rollback();
              return 'conflict';
            }
            throw error;
          }
        } else if (item.expectedRevision === undefined) {
          await connection.query<ResultSetHeader>(
            `INSERT INTO storage_documents (namespace, domain, record_key, payload, revision)
             VALUES (?, ?, ?, CAST(? AS JSON), 1)
             ON DUPLICATE KEY UPDATE payload = VALUES(payload), revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3)`,
            [namespace, domain, item.key, encoded],
          );
        } else {
          const [result] = await connection.query<ResultSetHeader>(
            'UPDATE storage_documents SET payload = CAST(? AS JSON), revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE namespace = ? AND domain = ? AND record_key = ? AND revision = ?',
            [encoded, namespace, domain, item.key, item.expectedRevision],
          );
          if (result.affectedRows === 0) {
            await connection.rollback();
            return 'conflict';
          }
        }
      }

      const documents: DocumentRecord[] = [];
      for (const item of puts) {
        const [rows] = await connection.query<DocumentRow[]>(
          'SELECT domain, record_key, payload, revision, created_at, updated_at FROM storage_documents WHERE namespace = ? AND domain = ? AND record_key = ? LIMIT 1',
          [namespace, domain, item.key],
        );
        if (rows[0]) documents.push(documentFromRow(rows[0]));
      }
      await connection.commit();
      return { documents, deleted };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export class MysqlBlobRepository implements BlobRepository {
  constructor(private readonly pool: Pool) {}

  async list(namespace: string): Promise<BlobMetadata[]> {
    const [rows] = await this.pool.query<BlobMetaRow[]>(
      'SELECT storage_key, mime_type, byte_size, created_at, updated_at FROM storage_blobs WHERE namespace = ? ORDER BY storage_key',
      [namespace],
    );
    return rows.map(blobMetaFromRow);
  }

  async getMetadata(namespace: string, key: string): Promise<BlobMetadata | null> {
    const [rows] = await this.pool.query<BlobMetaRow[]>(
      'SELECT storage_key, mime_type, byte_size, created_at, updated_at FROM storage_blobs WHERE namespace = ? AND storage_key = ? LIMIT 1',
      [namespace, key],
    );
    return rows[0] ? blobMetaFromRow(rows[0]) : null;
  }

  async getContent(namespace: string, key: string, start?: number, end?: number): Promise<Buffer | null> {
    const ranged = start !== undefined;
    const [rows] = await this.pool.query<BlobContentRow[]>(
      ranged
        ? 'SELECT SUBSTRING(content, ?, ?) AS content FROM storage_blobs WHERE namespace = ? AND storage_key = ? LIMIT 1'
        : 'SELECT content FROM storage_blobs WHERE namespace = ? AND storage_key = ? LIMIT 1',
      ranged ? [start + 1, (end ?? start) - start + 1, namespace, key] : [namespace, key],
    );
    return rows[0]?.content ?? null;
  }

  async put(namespace: string, key: string, mimeType: string, content: Buffer): Promise<BlobMetadata> {
    await this.pool.query<ResultSetHeader>(
      `INSERT INTO storage_blobs (namespace, storage_key, mime_type, byte_size, content)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), byte_size = VALUES(byte_size), content = VALUES(content), updated_at = CURRENT_TIMESTAMP(3)`,
      [namespace, key, mimeType, content.byteLength, content],
    );
    const saved = await this.getMetadata(namespace, key);
    if (!saved) throw new Error('Failed to save blob');
    return saved;
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>('DELETE FROM storage_blobs WHERE namespace = ? AND storage_key = ?', [namespace, key]);
    return result.affectedRows > 0;
  }
}

export function createMysqlRepositories(pool: Pool): StorageRepositories {
  return {
    documents: new MysqlDocumentRepository(pool),
    blobs: new MysqlBlobRepository(pool),
    health: async () => {
      await pool.query('SELECT 1');
    },
  };
}
