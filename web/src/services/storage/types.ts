export type StorageDriver = "browser" | "mysql";
export const STORAGE_ERROR_EVENT = "infinite-canvas:storage-error";

export type StorageDomain = "canvas" | "canvas_folders" | "assets" | "image_generation_logs" | "video_generation_logs";

export type StorageRuntimeConfig = {
    driver: StorageDriver;
    namespace: string;
};

export type StorageDocument<T> = {
    key: string;
    payload: T;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type StorageBlobMetadata = {
    storageKey: string;
    mimeType: string;
    byteSize: number;
    createdAt?: string;
    updatedAt?: string;
};

export type DocumentBatch = {
    puts: Array<{ key: string; payload: unknown; revision?: number | null }>;
    deletes: Array<{ key: string; revision?: number }>;
};

export type DocumentBatchResult = {
    documents: Array<StorageDocument<unknown>>;
    deleted: string[];
};

export interface DocumentRepository {
    get<T>(domain: StorageDomain, key: string): Promise<StorageDocument<T> | null>;
    list<T>(domain: StorageDomain): Promise<Array<StorageDocument<T>>>;
    put<T>(domain: StorageDomain, key: string, payload: T, revision?: number | null): Promise<StorageDocument<T>>;
    delete(domain: StorageDomain, key: string, revision?: number): Promise<void>;
    batch(domain: StorageDomain, changes: DocumentBatch): Promise<DocumentBatchResult>;
}

export interface BlobRepository {
    get(storageKey: string): Promise<Blob | null>;
    has(storageKey: string): Promise<boolean>;
    put(storageKey: string, blob: Blob): Promise<StorageBlobMetadata>;
    delete(storageKey: string): Promise<void>;
    list(): Promise<StorageBlobMetadata[]>;
    resolveUrl(storageKey: string): Promise<string | null>;
}

export class StorageRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = "StorageRequestError";
    }
}

let lastStorageError = "";

export function notifyStorageError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    lastStorageError = detail;
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<string>(STORAGE_ERROR_EVENT, { detail }));
}

export function getLastStorageError() {
    return lastStorageError;
}
