import type { BlobRepository, DocumentBatch, DocumentBatchResult, DocumentRepository, StorageBlobMetadata, StorageDocument, StorageDomain } from "@/services/storage/types";
import { notifyStorageError, StorageRequestError } from "@/services/storage/types";
import { appendPlatformSessionBinding, clearPlatformSessionBinding, withPlatformSessionBinding } from "@/services/platform-session";
import { appPath } from "@/lib/app-base-path";

const STORAGE_API_BASE = appPath("/api/storage");
const STORAGE_REQUEST_TIMEOUT_MS = 15_000;

type ErrorBody = { error?: { code?: string; message?: string } };
let sessionBindingRecovery: Promise<void> | null = null;

async function request(input: string, init?: RequestInit) {
    const response = await storageFetch(`${STORAGE_API_BASE}${input}`, init);
    if (response.ok) return response;
    return throwResponseError(response);
}

async function storageFetch(input: RequestInfo | URL, init?: RequestInit) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), STORAGE_REQUEST_TIMEOUT_MS);
    try {
        const fetchStorage = () =>
            fetch(input, {
                ...init,
                credentials: "include",
                headers: withPlatformSessionBinding(init?.headers),
                signal: controller.signal,
            });
        const response = await fetchStorage();
        if (!(await isSessionBindingMismatch(response, init?.method))) return response;
        await recoverSessionBinding();
        return await fetchStorage();
    } catch (error) {
        const resolved = error instanceof Error && error.name === "AbortError" ? new Error("Storage request timed out. Check the storage service and reverse proxy.") : error;
        notifyStorageError(resolved);
        throw resolved;
    } finally {
        globalThis.clearTimeout(timer);
    }
}

async function isSessionBindingMismatch(response: Response, method?: string) {
    if (response.status !== 403) return false;
    if (method?.toUpperCase() === "HEAD") return true;
    try {
        const body = (await response.clone().json()) as ErrorBody;
        return body.error?.code === "session_binding_mismatch";
    } catch {
        return false;
    }
}

function recoverSessionBinding() {
    if (sessionBindingRecovery) return sessionBindingRecovery;
    clearPlatformSessionBinding();
    sessionBindingRecovery = import("@/services/api/platform")
        .then(({ platformApi }) => platformApi.getContext())
        .then(() => undefined)
        .finally(() => {
            sessionBindingRecovery = null;
        });
    return sessionBindingRecovery;
}

async function throwResponseError(response: Response): Promise<never> {
    let body: ErrorBody = {};
    try {
        body = (await response.json()) as ErrorBody;
    } catch {
        // Keep the status text when a reverse proxy returned a non-JSON body.
    }
    const error = new StorageRequestError(body.error?.message || response.statusText || "Storage request failed", response.status, body.error?.code || "storage_request_failed");
    notifyStorageError(error);
    throw error;
}

function documentPath(domain: StorageDomain, key?: string) {
    return `/documents/${encodeURIComponent(domain)}${key === undefined ? "" : `/${encodeDocumentKey(key)}`}`;
}

function encodeDocumentKey(key: string) {
    if (!key || key.length > 512 || key.includes("/") || key.includes("\\") || key.includes("\0")) throw new Error("Storage document keys cannot contain slashes and must be at most 512 characters");
    return encodeURIComponent(key);
}

function blobPath(storageKey?: string) {
    return `/blobs${storageKey === undefined ? "" : `/${encodeURIComponent(storageKey)}`}`;
}

export class HttpDocumentRepository implements DocumentRepository {
    private readonly revisions = new Map<string, number>();

    async get<T>(domain: StorageDomain, key: string) {
        const response = await storageFetch(`${STORAGE_API_BASE}${documentPath(domain, key)}`);
        if (response.status === 404) {
            this.revisions.delete(this.revisionKey(domain, key));
            return null;
        }
        if (!response.ok) await throwResponseError(response);
        const body = (await response.json()) as { document: StorageDocument<T> };
        const document = body.document;
        this.remember(domain, document);
        return document;
    }

    async list<T>(domain: StorageDomain) {
        const response = await request(documentPath(domain));
        const body = (await response.json()) as { documents: Array<StorageDocument<T>> };
        const documents = body.documents;
        const prefix = `${domain}\n`;
        for (const key of this.revisions.keys()) {
            if (key.startsWith(prefix)) this.revisions.delete(key);
        }
        documents.forEach((document) => this.remember(domain, document));
        return documents;
    }

    async put<T>(domain: StorageDomain, key: string, payload: T, revision: number | null | undefined = this.revisions.get(this.revisionKey(domain, key))) {
        const response = await request(documentPath(domain, key), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload, ...(revision === undefined || revision === null ? {} : { revision }) }),
        });
        const body = (await response.json()) as { document: StorageDocument<T> };
        const document = body.document;
        this.remember(domain, document);
        return document;
    }

    async delete(domain: StorageDomain, key: string, revision = this.revisions.get(this.revisionKey(domain, key))) {
        const response = await storageFetch(`${STORAGE_API_BASE}${documentPath(domain, key)}`, {
            method: "DELETE",
            headers: revision === undefined ? undefined : { "If-Match": String(revision) },
        });
        if (!response.ok && response.status !== 404) await throwResponseError(response);
        this.revisions.delete(this.revisionKey(domain, key));
    }

    async batch(domain: StorageDomain, changes: DocumentBatch) {
        const response = await request(`${documentPath(domain)}/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(changes),
        });
        const result = (await response.json()) as DocumentBatchResult;
        result.documents.forEach((document) => this.remember(domain, document));
        result.deleted.forEach((key) => this.revisions.delete(this.revisionKey(domain, key)));
        return result;
    }

    reset() {
        this.revisions.clear();
    }

    private remember<T>(domain: StorageDomain, document: StorageDocument<T>) {
        this.revisions.set(this.revisionKey(domain, document.key), document.revision);
    }

    private revisionKey(domain: StorageDomain, key: string) {
        return `${domain}\n${key}`;
    }
}

export class HttpBlobRepository implements BlobRepository {
    async get(storageKey: string) {
        const response = await storageFetch(`${STORAGE_API_BASE}${blobPath(storageKey)}`);
        if (response.status === 404) return null;
        if (!response.ok) await throwResponseError(response);
        return response.blob();
    }

    async has(storageKey: string) {
        const response = await storageFetch(`${STORAGE_API_BASE}${blobPath(storageKey)}`, { method: "HEAD" });
        if (response.status === 404) return false;
        if (!response.ok) await throwResponseError(response);
        return true;
    }

    async put(storageKey: string, blob: Blob) {
        const response = await request(blobPath(storageKey), {
            method: "PUT",
            headers: { "Content-Type": blob.type || "application/octet-stream" },
            body: blob,
        });
        const body = (await response.json()) as { blob: ServerBlobMetadata };
        return fromServerBlob(body.blob);
    }

    async delete(storageKey: string) {
        const response = await storageFetch(`${STORAGE_API_BASE}${blobPath(storageKey)}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) await throwResponseError(response);
    }

    async list() {
        const response = await request(blobPath());
        const body = (await response.json()) as { blobs: ServerBlobMetadata[] };
        return body.blobs.map(fromServerBlob);
    }

    async resolveUrl(storageKey: string) {
        return (await this.has(storageKey)) ? appendPlatformSessionBinding(`${STORAGE_API_BASE}${blobPath(storageKey)}`) : null;
    }
}

export const httpDocumentRepository = new HttpDocumentRepository();
export const httpBlobRepository = new HttpBlobRepository();

export function resetHttpStorageRepositories() {
    httpDocumentRepository.reset();
}

type ServerBlobMetadata = Omit<StorageBlobMetadata, "storageKey"> & { key: string };

function fromServerBlob(metadata: ServerBlobMetadata): StorageBlobMetadata {
    return { ...metadata, storageKey: metadata.key };
}
