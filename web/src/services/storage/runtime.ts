import { browserBlobRepository, browserDocumentRepository } from "@/services/storage/browser-repository";
import { httpBlobRepository, httpDocumentRepository } from "@/services/storage/http-repository";
import { notifyStorageError } from "@/services/storage/types";
import type { BlobRepository, DocumentRepository, StorageRuntimeConfig } from "@/services/storage/types";

let runtimeConfigPromise: Promise<StorageRuntimeConfig> | undefined;
const STORAGE_CONFIG_TIMEOUT_MS = 10_000;

export function getStorageRuntimeConfig() {
    if (!runtimeConfigPromise)
        runtimeConfigPromise = loadStorageRuntimeConfig().catch((error) => {
            runtimeConfigPromise = undefined;
            throw error;
        });
    return runtimeConfigPromise;
}

export async function getDocumentRepository(): Promise<DocumentRepository> {
    return (await getStorageRuntimeConfig()).driver === "mysql" ? httpDocumentRepository : browserDocumentRepository;
}

export async function getBlobRepository(): Promise<BlobRepository> {
    return (await getStorageRuntimeConfig()).driver === "mysql" ? httpBlobRepository : browserBlobRepository;
}

async function loadStorageRuntimeConfig(): Promise<StorageRuntimeConfig> {
    if (typeof window === "undefined") return { driver: "browser", namespace: "default" };
    let response: Response;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), STORAGE_CONFIG_TIMEOUT_MS);
    try {
        response = await fetch("/api/storage/config", { headers: { Accept: "application/json" }, signal: controller.signal });
    } catch (error) {
        const resolved = error instanceof Error && error.name === "AbortError" ? new Error("Storage configuration request timed out. Check the application service and reverse proxy.") : error;
        notifyStorageError(resolved);
        throw resolved;
    } finally {
        globalThis.clearTimeout(timer);
    }
    if (response.headers.get("content-type")?.includes("text/html")) {
        // Static-only hosts rewrite unknown routes to index.html and can only use browser storage.
        return { driver: "browser", namespace: "default" };
    }
    if (!response.ok) return failStorageConfig(`Storage configuration is unavailable (${response.status})`);
    const config = (await response.json()) as Partial<StorageRuntimeConfig>;
    if (config.driver !== "browser" && config.driver !== "mysql") return failStorageConfig("Storage configuration returned an invalid driver");
    return { driver: config.driver, namespace: config.namespace?.trim() || "default" };
}

function failStorageConfig(message: string): never {
    const error = new Error(message);
    notifyStorageError(error);
    throw error;
}

export function resetStorageRuntimeForTests() {
    runtimeConfigPromise = undefined;
}
