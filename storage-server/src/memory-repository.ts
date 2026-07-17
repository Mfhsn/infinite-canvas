import type { BlobMetadata, BlobRecord, BlobRepository, DocumentRecord, DocumentRepository, StorageDomain, StorageRepositories } from './types.js';

function now(): string {
  return new Date().toISOString();
}

function docId(namespace: string, domain: string, key: string): string {
  return `${namespace}\0${domain}\0${key}`;
}

function blobId(namespace: string, key: string): string {
  return `${namespace}\0${key}`;
}

export class MemoryDocumentRepository implements DocumentRepository {
  private records = new Map<string, DocumentRecord>();

  async list(namespace: string, domain: StorageDomain): Promise<DocumentRecord[]> {
    const prefix = `${namespace}\0${domain}\0`;
    return [...this.records.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .map(([, record]) => record)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async get(namespace: string, domain: StorageDomain, key: string): Promise<DocumentRecord | null> {
    return this.records.get(docId(namespace, domain, key)) ?? null;
  }

  async put(namespace: string, domain: StorageDomain, key: string, payload: unknown, expectedRevision?: number): Promise<DocumentRecord | 'conflict'> {
    const id = docId(namespace, domain, key);
    const existing = this.records.get(id);
    if (expectedRevision !== undefined && (!existing || existing.revision !== expectedRevision)) return 'conflict';
    const timestamp = now();
    const record: DocumentRecord = {
      domain,
      key,
      payload,
      revision: existing ? existing.revision + 1 : 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.records.set(id, record);
    return record;
  }

  async delete(namespace: string, domain: StorageDomain, key: string, expectedRevision?: number): Promise<boolean | 'conflict'> {
    const id = docId(namespace, domain, key);
    const current = this.records.get(id);
    if (expectedRevision !== undefined && (!current || current.revision !== expectedRevision)) return 'conflict';
    return this.records.delete(id);
  }

  async batch(
    namespace: string,
    domain: StorageDomain,
    puts: Array<{ key: string; payload: unknown; expectedRevision?: number | null }>,
    deletes: Array<{ key: string; expectedRevision?: number }>,
  ): Promise<{ documents: DocumentRecord[]; deleted: string[] } | 'conflict'> {
    const snapshot = new Map(this.records);
    const deleted: string[] = [];
    const documents: DocumentRecord[] = [];
    for (const item of deletes) {
      const result = await this.delete(namespace, domain, item.key, item.expectedRevision);
      if (result === 'conflict') {
        this.records = snapshot;
        return 'conflict';
      }
      if (result) deleted.push(item.key);
    }
    for (const item of puts) {
      if (item.expectedRevision === null && await this.get(namespace, domain, item.key)) {
        this.records = snapshot;
        return 'conflict';
      }
      const result = await this.put(namespace, domain, item.key, item.payload, item.expectedRevision ?? undefined);
      if (result === 'conflict') {
        this.records = snapshot;
        return 'conflict';
      }
      documents.push(result);
    }
    return { documents, deleted };
  }
}

export class MemoryBlobRepository implements BlobRepository {
  private records = new Map<string, BlobRecord>();

  async list(namespace: string): Promise<BlobMetadata[]> {
    const prefix = `${namespace}\0`;
    return [...this.records.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .map(([, record]) => ({ key: record.key, mimeType: record.mimeType, byteSize: record.byteSize, createdAt: record.createdAt, updatedAt: record.updatedAt }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async getMetadata(namespace: string, key: string): Promise<BlobMetadata | null> {
    const record = this.records.get(blobId(namespace, key));
    if (!record) return null;
    const { content: _content, ...metadata } = record;
    return metadata;
  }

  async getContent(namespace: string, key: string, start?: number, end?: number): Promise<Buffer | null> {
    const content = this.records.get(blobId(namespace, key))?.content;
    if (!content) return null;
    return start === undefined ? content : content.subarray(start, (end ?? content.byteLength - 1) + 1);
  }

  async put(namespace: string, key: string, mimeType: string, content: Buffer): Promise<BlobMetadata> {
    const id = blobId(namespace, key);
    const existing = this.records.get(id);
    const timestamp = now();
    const record: BlobRecord = {
      key,
      mimeType,
      byteSize: content.byteLength,
      content,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.records.set(id, record);
    const { content: _content, ...metadata } = record;
    return metadata;
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    return this.records.delete(blobId(namespace, key));
  }
}

export function createMemoryRepositories(): StorageRepositories {
  return { documents: new MemoryDocumentRepository(), blobs: new MemoryBlobRepository() };
}
