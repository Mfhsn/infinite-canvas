import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";

import { getDocumentStore } from "@/services/storage/document-store";
import { getDocumentRepository, getStorageRuntimeConfig } from "@/services/storage/runtime";
import {
    COLLECTION_ORDER_KEY,
    CollectionRevisionTracker,
    collectionUsesOrder,
    orderCollectionDocuments,
    parsePersistedCollection,
    serializePersistedCollection,
    serializeStoragePayload,
    type PersistedCollectionField,
} from "@/services/storage/persisted-collection";
import type { DocumentBatch } from "@/services/storage/types";
import type { StoreWriteStatus } from "@/types/canvas-library";

const collectionFields = { canvas: "projects", canvas_folders: "folders", assets: "assets" } as const;
type CollectionDomain = keyof typeof collectionFields;

export type GenerationAwarePersistStorage<T> = {
    persist: PersistStorage<T>;
    flush: () => Promise<void>;
    retryWrite: () => Promise<void>;
};

type GenerationAwareOptions<T> = {
    debounceMs?: number;
    getGeneration: () => number;
    initialValue?: StorageValue<T>;
    normalizeValue?: (value: StorageValue<T>) => StorageValue<T>;
    onWriteState?: (status: StoreWriteStatus, error?: Error, generation?: number) => void;
};

type WriteSnapshot = { name: string; value: string; generation: number };

function errorValue(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
}

export function createGenerationAwarePersistStorage<T>(base: StateStorage, options: GenerationAwareOptions<T>): GenerationAwarePersistStorage<T> {
    const debounceMs = options.debounceMs ?? 400;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: WriteSnapshot | null = null;
    let latest: WriteSnapshot | null = null;
    let failed: WriteSnapshot | null = null;
    let failedError: Error | null = null;
    let lastSerialized: string | null = options.initialValue ? JSON.stringify(options.initialValue) : null;
    let queue = Promise.resolve();
    let latestAttempt: Promise<void> = Promise.resolve();

    const enqueue = (task: () => Promise<void>) => {
        const attempt = queue.then(task, task);
        queue = attempt.catch(() => undefined);
        latestAttempt = attempt;
        return attempt;
    };

    const write = (snapshot: WriteSnapshot) =>
        enqueue(async () => {
            if (snapshot.generation === options.getGeneration()) options.onWriteState?.("pending", undefined, snapshot.generation);
            try {
                await base.setItem(snapshot.name, snapshot.value);
                if (failed && failed.generation <= snapshot.generation) {
                    failed = null;
                    failedError = null;
                }
                if (snapshot.generation === options.getGeneration()) options.onWriteState?.("success", undefined, snapshot.generation);
            } catch (error) {
                const nextError = errorValue(error);
                if (!failed || failed.generation <= snapshot.generation) {
                    failed = snapshot;
                    failedError = nextError;
                }
                if (snapshot.generation === options.getGeneration()) options.onWriteState?.("error", nextError, snapshot.generation);
                throw nextError;
            }
        });

    const settlePending = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const snapshot = pending;
        pending = null;
        return snapshot ? write(snapshot) : latestAttempt;
    };

    const persist: PersistStorage<T> = {
        getItem: async (name) => {
            const value = await base.getItem(name);
            if (!value) return null;
            const normalized = options.normalizeValue?.(JSON.parse(value) as StorageValue<T>) ?? (JSON.parse(value) as StorageValue<T>);
            lastSerialized = JSON.stringify(normalized);
            return normalized;
        },
        setItem: (name, value) => {
            const serialized = JSON.stringify(value);
            if (serialized === lastSerialized) return;
            lastSerialized = serialized;
            const snapshot = { name, value: serialized, generation: options.getGeneration() };
            latest = snapshot;
            pending = snapshot;
            options.onWriteState?.("pending", undefined, snapshot.generation);
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                const queued = pending;
                pending = null;
                if (queued) void write(queued).catch(() => undefined);
            }, debounceMs);
        },
        removeItem: (name) =>
            enqueue(async () => {
                await base.removeItem(name);
            }),
    };

    return {
        persist,
        flush: async () => {
            await settlePending();
        },
        retryWrite: async () => {
            if (!failed) return settlePending();
            if (options.getGeneration() === failed.generation) {
                options.onWriteState?.("pending", failedError ?? undefined, failed.generation);
                return write(failed);
            }
            if (pending) return settlePending();
            if (latest && latest.generation === options.getGeneration()) return write(latest);
            throw new Error("The failed write is stale and no current snapshot is available");
        },
    };
}

export function createDataStateStorage(domain: CollectionDomain): StateStorage {
    const store = getDocumentStore(domain);
    const field: PersistedCollectionField = collectionFields[domain];
    const usesOrder = collectionUsesOrder(field);
    const revisionTracker = new CollectionRevisionTracker();
    let orderBaseline: { payload: string; revision: number } | null = null;
    let writeQueue = Promise.resolve();
    const enqueue = (task: () => Promise<void>) => {
        const next = writeQueue.then(task, task);
        writeQueue = next.catch(() => undefined);
        return next;
    };
    return {
        getItem: async (name) => {
            if (typeof window === "undefined") return null;
            try {
                if ((await getStorageRuntimeConfig()).driver === "mysql") {
                    const documents = await (await getDocumentRepository()).list<unknown>(domain);
                    const orderDocument = usesOrder ? documents.find((document) => document.key === COLLECTION_ORDER_KEY) : undefined;
                    const records = documents.filter(
                        (document): document is typeof document & { payload: Record<string, unknown> } => document.key !== COLLECTION_ORDER_KEY && Boolean(document.payload && typeof document.payload === "object" && !Array.isArray(document.payload)),
                    );
                    revisionTracker.hydrate(records);
                    orderBaseline = orderDocument ? { payload: serializeStoragePayload(orderDocument.payload), revision: orderDocument.revision } : null;
                    if (!records.length) return null;
                    const ordered = usesOrder ? orderCollectionDocuments(records, orderDocument?.payload) : records;
                    return serializePersistedCollection(
                        ordered.map((document) => document.payload),
                        field,
                    );
                }
                return (await store.getItem<string>(name)) || null;
            } catch (error) {
                if ((await getStorageRuntimeConfig()).driver !== "browser") throw error;
                return window.localStorage.getItem(name);
            }
        },
        setItem: (name, value) =>
            enqueue(async () => {
                if (typeof window === "undefined") return;
                try {
                    if ((await getStorageRuntimeConfig()).driver === "mysql") {
                        const items = parsePersistedCollection(value, field);
                        const repository = await getDocumentRepository();
                        const plan = revisionTracker.plan(items);
                        const puts: DocumentBatch["puts"] = plan.changed.map(({ item, revision }) => ({ key: item.id, payload: item, revision }));
                        if (usesOrder) {
                            const order = items.map((item) => item.id);
                            const orderPayload = serializeStoragePayload(order);
                            if (orderBaseline?.payload !== orderPayload) puts.push({ key: COLLECTION_ORDER_KEY, payload: order, revision: orderBaseline?.revision ?? null });
                        }
                        if (!puts.length && !plan.deleted.length) return;
                        const result = await repository.batch(domain, { puts, deletes: plan.deleted.map(({ id, revision }) => ({ key: id, revision })) });
                        result.deleted.forEach((id) => revisionTracker.deleted(id));
                        result.documents.forEach((document) => {
                            if (document.key === COLLECTION_ORDER_KEY) orderBaseline = { payload: serializeStoragePayload(document.payload), revision: document.revision };
                            else if (document.payload && typeof document.payload === "object" && !Array.isArray(document.payload)) revisionTracker.saved(document as typeof document & { payload: Record<string, unknown> });
                        });
                        return;
                    }
                    await store.setItem(name, value);
                } catch (error) {
                    if ((await getStorageRuntimeConfig()).driver !== "browser") throw error;
                    window.localStorage.setItem(name, value);
                }
            }),
        removeItem: (name) =>
            enqueue(async () => {
                if (typeof window === "undefined") return;
                try {
                    if ((await getStorageRuntimeConfig()).driver === "mysql") {
                        const repository = await getDocumentRepository();
                        const documents = await repository.list(domain);
                        await repository.batch(domain, { puts: [], deletes: documents.map((document) => ({ key: document.key, revision: document.revision })) });
                        revisionTracker.clear();
                        orderBaseline = null;
                        return;
                    }
                    await store.removeItem(name);
                } catch (error) {
                    if ((await getStorageRuntimeConfig()).driver !== "browser") throw error;
                    window.localStorage.removeItem(name);
                }
            }),
    };
}
