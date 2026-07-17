import type { StateStorage } from "zustand/middleware";

import { getDocumentStore } from "@/services/storage/document-store";
import { getDocumentRepository, getStorageRuntimeConfig } from "@/services/storage/runtime";
import { COLLECTION_ORDER_KEY, CollectionRevisionTracker, orderCollectionDocuments, parsePersistedCollection, serializePersistedCollection, serializeStoragePayload } from "@/services/storage/persisted-collection";
import type { DocumentBatch, StorageDomain } from "@/services/storage/types";

const collectionFields = { canvas: "projects", assets: "assets" } as const;

export function createDataStateStorage(domain: Extract<StorageDomain, "canvas" | "assets">): StateStorage {
    const store = getDocumentStore(domain);
    const field = collectionFields[domain];
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
                    const orderDocument = documents.find((document) => document.key === COLLECTION_ORDER_KEY);
                    const records = documents.filter(
                        (document): document is typeof document & { payload: Record<string, unknown> } => document.key !== COLLECTION_ORDER_KEY && Boolean(document.payload && typeof document.payload === "object" && !Array.isArray(document.payload)),
                    );
                    revisionTracker.hydrate(records);
                    orderBaseline = orderDocument ? { payload: serializeStoragePayload(orderDocument.payload), revision: orderDocument.revision } : null;
                    if (!records.length) return null;
                    const ordered = orderCollectionDocuments(records, orderDocument?.payload);
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
                        const order = items.map((item) => item.id);
                        const orderPayload = serializeStoragePayload(order);
                        const puts: DocumentBatch["puts"] = plan.changed.map(({ item, revision }) => ({ key: item.id, payload: item, revision }));
                        if (orderBaseline?.payload !== orderPayload) puts.push({ key: COLLECTION_ORDER_KEY, payload: order, revision: orderBaseline?.revision ?? null });
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
                        await Promise.all(documents.map((document) => repository.delete(domain, document.key, document.revision)));
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
