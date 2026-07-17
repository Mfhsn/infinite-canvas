export type PersistedCollectionField = "projects" | "assets";
export const COLLECTION_ORDER_KEY = "__collection_order__";
import type { StorageDocument } from "@/services/storage/types";

type CollectionRecord = Record<string, unknown> & { id: string };

export function parsePersistedCollection(value: string, field: PersistedCollectionField) {
    const parsed = JSON.parse(value) as { state?: Record<string, unknown> };
    const items = parsed.state?.[field];
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof (item as Record<string, unknown>).id !== "string" || !(item as Record<string, unknown>).id) {
            throw new Error("Stored canvas and asset records require an id");
        }
        return item as Record<string, unknown> & { id: string };
    });
}

export function serializePersistedCollection(items: Array<Record<string, unknown>>, field: PersistedCollectionField) {
    return JSON.stringify({ state: { [field]: items }, version: 0 });
}

export function orderCollectionDocuments<T extends { key: string; payload: Record<string, unknown> }>(documents: T[], orderPayload: unknown) {
    const order = Array.isArray(orderPayload) ? orderPayload.filter((value): value is string => typeof value === "string") : [];
    const positions = new Map(order.map((id, index) => [id, index]));
    return [...documents].sort((left, right) => {
        const leftPosition = positions.get(left.key);
        const rightPosition = positions.get(right.key);
        if (leftPosition !== undefined || rightPosition !== undefined) return (leftPosition ?? Number.MAX_SAFE_INTEGER) - (rightPosition ?? Number.MAX_SAFE_INTEGER);
        return String(right.payload.createdAt || "").localeCompare(String(left.payload.createdAt || ""));
    });
}

export class CollectionRevisionTracker {
    private readonly baseline = new Map<string, { payload: string; revision: number }>();

    hydrate(documents: Array<StorageDocument<Record<string, unknown>>>) {
        this.baseline.clear();
        documents.forEach((document) => this.baseline.set(document.key, { payload: serializeStoragePayload(document.payload), revision: document.revision }));
    }

    plan(items: CollectionRecord[]) {
        const nextIds = new Set(items.map((item) => item.id));
        const deleted = Array.from(this.baseline.entries())
            .filter(([id]) => !nextIds.has(id))
            .map(([id, value]) => ({ id, revision: value.revision }));
        const changed = items.flatMap((item) => {
            const payload = serializeStoragePayload(item);
            const baseline = this.baseline.get(item.id);
            return baseline?.payload === payload ? [] : [{ item, payload, revision: baseline?.revision ?? null }];
        });
        return { deleted, changed };
    }

    saved(document: StorageDocument<Record<string, unknown>>) {
        this.baseline.set(document.key, { payload: serializeStoragePayload(document.payload), revision: document.revision });
    }

    deleted(id: string) {
        this.baseline.delete(id);
    }

    clear() {
        this.baseline.clear();
    }
}

export function serializeStoragePayload(value: unknown) {
    return JSON.stringify(value) ?? "null";
}
