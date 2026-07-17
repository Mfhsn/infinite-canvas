import localforage from "localforage";

import type { BlobRepository, DocumentBatch, DocumentRepository, StorageBlobMetadata, StorageDocument, StorageDomain } from "@/services/storage/types";

const documentStores: Record<StorageDomain, LocalForage> = {
    canvas: localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" }),
    assets: localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" }),
    image_generation_logs: localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" }),
    video_generation_logs: localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" }),
};

const imageBlobStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const mediaBlobStore = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();
const stateKeys: Partial<Record<StorageDomain, string>> = {
    canvas: "infinite-canvas:canvas_store",
    assets: "infinite-canvas:asset_store",
};

function browserDocument<T>(key: string, payload: T): StorageDocument<T> {
    return { key, payload, revision: 0, createdAt: "", updatedAt: "" };
}

export class BrowserDocumentRepository implements DocumentRepository {
    async get<T>(domain: StorageDomain, key: string) {
        const value = await documentStores[domain].getItem<T>(key);
        return value === null ? null : browserDocument(key, value);
    }

    async list<T>(domain: StorageDomain) {
        const documents: Array<StorageDocument<T>> = [];
        await documentStores[domain].iterate<T, void>((value, key) => {
            if (!stateKeys[domain] || stateKeys[domain] === key) documents.push(browserDocument(key, value));
        });
        return documents;
    }

    async put<T>(domain: StorageDomain, key: string, payload: T, _revision?: number | null) {
        await documentStores[domain].setItem(key, payload);
        return browserDocument(key, payload);
    }

    async delete(domain: StorageDomain, key: string) {
        await documentStores[domain].removeItem(key);
    }

    async batch(domain: StorageDomain, changes: DocumentBatch) {
        await Promise.all(changes.deletes.map(({ key }) => this.delete(domain, key)));
        const documents = await Promise.all(changes.puts.map(({ key, payload, revision }) => this.put(domain, key, payload, revision)));
        return { documents, deleted: changes.deletes.map(({ key }) => key) };
    }
}

function blobStore(storageKey: string) {
    return storageKey.startsWith("image:") ? imageBlobStore : mediaBlobStore;
}

export class BrowserBlobRepository implements BlobRepository {
    async get(storageKey: string) {
        return blobStore(storageKey).getItem<Blob>(storageKey);
    }

    async has(storageKey: string) {
        return (await this.get(storageKey)) !== null;
    }

    async put(storageKey: string, blob: Blob) {
        await blobStore(storageKey).setItem(storageKey, blob);
        this.revoke(storageKey);
        return { storageKey, mimeType: blob.type || "application/octet-stream", byteSize: blob.size };
    }

    async delete(storageKey: string) {
        this.revoke(storageKey);
        await blobStore(storageKey).removeItem(storageKey);
    }

    async list() {
        const values: StorageBlobMetadata[] = [];
        const append = async (store: LocalForage) => {
            await store.iterate<Blob, void>((blob, storageKey) => {
                values.push({ storageKey, mimeType: blob.type || "application/octet-stream", byteSize: blob.size });
            });
        };
        await append(imageBlobStore);
        await append(mediaBlobStore);
        return values;
    }

    async resolveUrl(storageKey: string) {
        const cached = objectUrls.get(storageKey);
        if (cached) return cached;
        const blob = await this.get(storageKey);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        objectUrls.set(storageKey, url);
        return url;
    }

    private revoke(storageKey: string) {
        const current = objectUrls.get(storageKey);
        if (current) URL.revokeObjectURL(current);
        objectUrls.delete(storageKey);
    }
}

export const browserDocumentRepository = new BrowserDocumentRepository();
export const browserBlobRepository = new BrowserBlobRepository();
