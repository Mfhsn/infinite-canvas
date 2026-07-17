import { browserBlobRepository, browserDocumentRepository } from "@/services/storage/browser-repository";
import { httpBlobRepository, httpDocumentRepository } from "@/services/storage/http-repository";
import { getStorageRuntimeConfig } from "@/services/storage/runtime";
import type { StorageDomain } from "@/services/storage/types";
import { COLLECTION_ORDER_KEY, parsePersistedCollection } from "@/services/storage/persisted-collection";

const domains: StorageDomain[] = ["canvas", "assets", "image_generation_logs", "video_generation_logs"];

export type BrowserDataMigrationResult = {
    documents: number;
    blobs: number;
    bytes: number;
    failures: Array<{ key: string; message: string }>;
};

export async function migrateBrowserDataToMysql(onProgress?: (completed: number, total: number) => void): Promise<BrowserDataMigrationResult> {
    const config = await getStorageRuntimeConfig();
    if (config.driver !== "mysql") throw new Error("Browser data can only be imported while the MySQL storage driver is active");

    const documentGroups = await Promise.all(domains.map(async (domain) => ({ domain, ...(await browserDocumentsForMigration(domain)) })));
    const blobs = await browserBlobRepository.list();
    const extractionFailures = documentGroups.flatMap((group) => group.failures);
    const total = blobs.length + extractionFailures.length + documentGroups.reduce((sum, group) => sum + group.documents.length, 0);
    let completed = 0;
    const result: BrowserDataMigrationResult = { documents: 0, blobs: 0, bytes: 0, failures: [...extractionFailures] };
    completed += extractionFailures.length;
    onProgress?.(completed, total);

    for (const metadata of blobs) {
        try {
            const blob = await browserBlobRepository.get(metadata.storageKey);
            if (!blob) throw new Error("Local file is missing");
            await httpBlobRepository.put(metadata.storageKey, blob);
            result.blobs += 1;
            result.bytes += blob.size;
        } catch (error) {
            result.failures.push({ key: metadata.storageKey, message: error instanceof Error ? error.message : String(error) });
        } finally {
            completed += 1;
            onProgress?.(completed, total);
        }
    }

    for (const group of documentGroups) {
        if (!group.documents.length) continue;
        try {
            const existing = await httpDocumentRepository.list<unknown>(group.domain);
            const existingByKey = new Map(existing.map((document) => [document.key, document]));
            const puts = group.documents.map((document) => ({ key: document.key, payload: document.payload, revision: existingByKey.get(document.key)?.revision ?? null }));
            if (group.domain === "canvas" || group.domain === "assets") {
                const localIds = group.documents.map((document) => document.key);
                const localIdSet = new Set(localIds);
                const existingIds = existing.filter((document) => document.key !== COLLECTION_ORDER_KEY && !localIdSet.has(document.key)).map((document) => document.key);
                puts.push({ key: COLLECTION_ORDER_KEY, payload: [...localIds, ...existingIds], revision: existingByKey.get(COLLECTION_ORDER_KEY)?.revision ?? null });
            }
            await httpDocumentRepository.batch(group.domain, { puts, deletes: [] });
            result.documents += group.documents.length;
        } catch (error) {
            result.failures.push({ key: group.domain, message: error instanceof Error ? error.message : String(error) });
        } finally {
            completed += group.documents.length;
            onProgress?.(completed, total);
        }
    }

    return result;
}

async function browserDocumentsForMigration(domain: StorageDomain) {
    const documents = await browserDocumentRepository.list(domain);
    if (!documents.length && (domain === "canvas" || domain === "assets") && typeof window !== "undefined") {
        const key = domain === "canvas" ? "infinite-canvas:canvas_store" : "infinite-canvas:asset_store";
        const payload = window.localStorage.getItem(key);
        if (payload) documents.push({ key, payload, revision: 0, createdAt: "", updatedAt: "" });
    }
    if (domain !== "canvas" && domain !== "assets") return { documents, failures: [] };
    const field = domain === "canvas" ? "projects" : "assets";
    const migrated: typeof documents = [];
    const failures: Array<{ key: string; message: string }> = [];
    for (const document of documents) {
        if (typeof document.payload !== "string") {
            failures.push({ key: `${domain}/${document.key}`, message: "Local collection is not a serialized document" });
            continue;
        }
        try {
            migrated.push(...parsePersistedCollection(document.payload, field).map((item) => ({ ...document, key: item.id, payload: item })));
        } catch (error) {
            failures.push({ key: `${domain}/${document.key}`, message: error instanceof Error ? error.message : String(error) });
        }
    }
    return { documents: migrated, failures };
}
