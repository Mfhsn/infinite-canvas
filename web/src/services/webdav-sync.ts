import type { WebdavSyncConfig } from "@/stores/use-config-store";
import { AppError } from "@/lib/app-error";
import type { I18nKey } from "@/i18n/messages";

export const WEBDAV_MANIFEST_FILE_NAME = "manifest.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 120000;
const ensuredDirectories = new Set<string>();

export type WebdavFileDownload = {
    file: Blob;
    etag?: string;
};

export type WebdavUploadOptions = {
    ifMatch?: string;
    ifNoneMatch?: "*";
};

export class WebdavPreconditionFailedError extends Error {
    constructor() {
        super("WebDAV conditional write precondition failed");
        this.name = "WebdavPreconditionFailedError";
    }
}

export async function testWebdavConnection(config: WebdavSyncConfig) {
    await ensureWebdavDirectory(config);
    const response = await webdavFetch(config, "", { method: "PROPFIND", headers: { Depth: "0" } });
    if (response.ok || response.status === 207) return;
    await throwWebdavError(response, "config.webdav.testFailed");
}

export async function downloadWebdavSyncFile(config: WebdavSyncConfig) {
    return downloadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME);
}

export async function downloadWebdavFile(config: WebdavSyncConfig, path: string) {
    return (await downloadWebdavFileWithMetadata(config, path))?.file ?? null;
}

export async function downloadWebdavFileWithMetadata(config: WebdavSyncConfig, path: string): Promise<WebdavFileDownload | null> {
    await ensureWebdavDirectory(config);
    const response = await webdavFetch(config, path, { method: "GET" });
    if (response.status === 404) return null;
    if (!response.ok) await throwWebdavError(response, "error.webdav.readFailed");
    const file = await withTimeout(response.blob(), "error.webdav.readTimeout");
    return file.size ? { file, etag: normalizeEtag(response.headers.get("ETag")) } : null;
}

export async function uploadWebdavSyncFile(config: WebdavSyncConfig, file: Blob) {
    return uploadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME, file, "application/json");
}

export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream", options: WebdavUploadOptions = {}) {
    if (!file.size) throw new AppError("error.webdav.emptyUpload");
    await ensureWebdavDirectory(config);
    await ensureWebdavSubdirectory(config, path);
    const headers = new Headers({ "Content-Type": contentType });
    if (options.ifMatch) headers.set("If-Match", options.ifMatch);
    if (options.ifNoneMatch) headers.set("If-None-Match", options.ifNoneMatch);
    const response = await webdavFetch(config, path, {
        method: "PUT",
        headers,
        body: file,
    });
    if (response.status === 412) throw new WebdavPreconditionFailedError();
    if (!response.ok) await throwWebdavError(response, "error.webdav.uploadFailed");
    return { etag: normalizeEtag(response.headers.get("ETag")) };
}

async function ensureWebdavDirectory(config: WebdavSyncConfig) {
    assertWebdavConfig(config);
    await ensureWebdavDirectoryPath(config, config.directory);
}

async function ensureWebdavSubdirectory(config: WebdavSyncConfig, path: string) {
    const directory = normalizePath(path).split("/").slice(0, -1).join("/");
    if (!directory) return;
    await ensureWebdavDirectoryPath(config, [config.directory, directory].filter(Boolean).join("/"));
}

async function ensureWebdavDirectoryPath(config: WebdavSyncConfig, directory: string) {
    const parts = normalizePath(directory).split("/").filter(Boolean);
    const cacheKey = `${config.url}:${parts.join("/")}`;
    if (ensuredDirectories.has(cacheKey)) return;
    let path = "";
    for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        const response = await webdavFetch({ ...config, directory: "" }, path, { method: "MKCOL" });
        if (response.ok || ((response.status === 405 || response.status === 423) && (await webdavDirectoryExists(config, path)))) continue;
        await throwWebdavError(response, "error.webdav.createDirectoryFailed");
    }
    ensuredDirectories.add(cacheKey);
}

async function webdavDirectoryExists(config: WebdavSyncConfig, path: string) {
    const response = await webdavFetch({ ...config, directory: "" }, path, { method: "PROPFIND", headers: { Depth: "0" } });
    return response.ok || response.status === 207;
}

async function webdavFetch(config: WebdavSyncConfig, path: string, init: RequestInit) {
    const headers = new Headers(init.headers);
    if (config.username || config.password) headers.set("Authorization", `Basic ${encodeBasicAuth(`${config.username}:${config.password}`)}`);
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
    try {
        const url = buildWebdavUrl(config, path);
        return await fetch(url, { ...init, headers, signal: controller.signal });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new AppError("error.webdav.timeout");
        if (error instanceof TypeError) throw new AppError("error.webdav.unreachable");
        throw error;
    } finally {
        globalThis.clearTimeout(timer);
    }
}

function buildWebdavUrl(config: WebdavSyncConfig, path: string) {
    const baseUrl = config.url.trim().replace(/\/+$/, "");
    const remotePath = [normalizePath(config.directory), normalizePath(path)].filter(Boolean).join("/");
    if (!remotePath) return baseUrl;
    return `${baseUrl}/${remotePath.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizePath(path: string) {
    return path.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeEtag(value: string | null) {
    const etag = value?.trim();
    return etag && !etag.startsWith("W/") ? etag : undefined;
}

function assertWebdavConfig(config: WebdavSyncConfig) {
    if (!config.url.trim()) throw new AppError("config.webdav.required");
}

async function throwWebdavError(response: Response, fallback: I18nKey): Promise<never> {
    const detail = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new AppError("error.webdav.authFailed");
    if (response.status === 404) throw new AppError("error.webdav.notFound");
    throw new AppError(fallback, { status: `: ${response.status}` }, detail ? { rawMessage: detail.slice(0, 120) } : undefined);
}

function encodeBasicAuth(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, key: I18nKey) {
    return new Promise<T>((resolve, reject) => {
        const timer = globalThis.setTimeout(() => reject(new AppError(key)), WEBDAV_REQUEST_TIMEOUT_MS);
        promise.then(resolve, reject).finally(() => globalThis.clearTimeout(timer));
    });
}
