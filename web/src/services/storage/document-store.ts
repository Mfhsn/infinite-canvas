import type { StorageDomain } from "@/services/storage/types";
import { getDocumentRepository } from "@/services/storage/runtime";

export type DocumentStore = {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
    iterate<T, U>(callback: (value: T, key: string, iterationNumber: number) => U): Promise<U | undefined>;
    replaceItems<T>(items: Array<{ key: string; value: T }>): Promise<void>;
};

const stores = new Map<StorageDomain, DocumentStore>();

export function getDocumentStore(domain: StorageDomain): DocumentStore {
    const current = stores.get(domain);
    if (current) return current;
    const store: DocumentStore = {
        async getItem<T>(key: string) {
            return (await (await getDocumentRepository()).get<T>(domain, key))?.payload ?? null;
        },
        async setItem<T>(key: string, value: T) {
            await (await getDocumentRepository()).put(domain, key, value);
            return value;
        },
        async removeItem(key: string) {
            await (await getDocumentRepository()).delete(domain, key);
        },
        async clear() {
            const repository = await getDocumentRepository();
            const documents = await repository.list(domain);
            await repository.batch(domain, { puts: [], deletes: documents.map((document) => ({ key: document.key, revision: document.revision })) });
        },
        async keys() {
            return (await (await getDocumentRepository()).list(domain)).map((document) => document.key);
        },
        async iterate<T, U>(callback: (value: T, key: string, iterationNumber: number) => U) {
            const documents = await (await getDocumentRepository()).list<T>(domain);
            let result: U | undefined;
            for (let index = 0; index < documents.length; index += 1) {
                const next = callback(documents[index].payload, documents[index].key, index + 1);
                if (next !== undefined) {
                    result = next;
                    break;
                }
            }
            return result;
        },
        async replaceItems<T>(items: Array<{ key: string; value: T }>) {
            const repository = await getDocumentRepository();
            const current = await repository.list(domain);
            const currentByKey = new Map(current.map((document) => [document.key, document]));
            const nextKeys = new Set(items.map((item) => item.key));
            await repository.batch(domain, {
                puts: items.map((item) => ({ key: item.key, payload: item.value, revision: currentByKey.get(item.key)?.revision ?? null })),
                deletes: current.filter((document) => !nextKeys.has(document.key)).map((document) => ({ key: document.key, revision: document.revision })),
            });
        },
    };
    stores.set(domain, store);
    return store;
}
