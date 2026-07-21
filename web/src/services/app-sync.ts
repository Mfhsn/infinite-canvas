import { AppError } from "@/lib/app-error";
import { mergeCanvasFolders, normalizeCanvasFolder, normalizeCanvasProject } from "@/lib/canvas/canvas-library";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { getDocumentStore, type DocumentStore } from "@/services/storage/document-store";
import { downloadWebdavFile, downloadWebdavFileWithMetadata, uploadWebdavFile, WebdavPreconditionFailedError, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import type { CanvasFolder } from "@/types/canvas-library";

type StoredLog = Record<string, unknown> & { id?: string };
export type AppSyncDomainKey = "canvas" | "canvas-folders" | "assets" | "image-workbench" | "video-workbench";
type CanvasDomainData = { projects: CanvasProject[] };
type CanvasFoldersDomainData = { folders: CanvasFolder[] };
type AssetDomainData = { assets: Asset[] };
type LogDomainData = { logs: StoredLog[] };

export type AppSyncFile = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export type DomainManifest<T = unknown> = {
    app: "infinite-canvas";
    version: 1;
    domain: AppSyncDomainKey;
    exportedAt: string;
    commitId?: string;
    data: T;
    files: AppSyncFile[];
};

type SyncDomainOptions<T> = {
    key: AppSyncDomainKey;
    localData: () => Promise<T>;
    mergeData: (local: T, remote: T) => T;
    applyData?: (data: T) => Promise<void>;
};

type SyncDomainResult<T> = {
    data: T;
    mergedRemote: boolean;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
    consistency: "etag" | "weak";
};

export type AppSyncResult = {
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    folders: number;
    assets: number;
    imageLogs: number;
    videoLogs: number;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
    completedDomains: AppSyncDomainKey[];
    failedDomains: AppSyncDomainKey[];
    weakConsistencyDomains: AppSyncDomainKey[];
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    stage: AppSyncStage;
    bytes?: number;
    detail?: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
    consistency?: "etag" | "weak";
};

export type AppSyncStage =
    | "waiting-local"
    | "complete"
    | "partial"
    | "read-remote"
    | "read-local"
    | "download-missing"
    | "apply-merged"
    | "upload-new"
    | "upload-manifest"
    | "conflict-retry"
    | "verify-write"
    | "weak-consistency"
    | "done"
    | "failed"
    | "scan-missing"
    | "media-complete"
    | "download-media"
    | "scan-local"
    | "no-upload"
    | "upload-media";

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

const ALL_SYNC_DOMAINS: AppSyncDomainKey[] = ["canvas", "canvas-folders", "assets", "image-workbench", "video-workbench"];
const FILE_CONCURRENCY = 3;
const MAX_MANIFEST_CONFLICT_RETRIES = 3;
const imageLogStore = getDocumentStore("image_generation_logs");
const videoLogStore = getDocumentStore("video_generation_logs");
type LogStore = DocumentStore;
const storageKeyPattern = /^(canvas-cover|image|video|audio|file|video-reference|audio-reference):/;

export async function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress, domains: AppSyncDomainKey[] = ALL_SYNC_DOMAINS): Promise<AppSyncResult> {
    const selectedDomains = Array.from(new Set(domains));
    emitProgress(onProgress, { stage: "waiting-local" });
    const settled = await Promise.allSettled(selectedDomains.map((domain) => syncSelectedDomain(config, onProgress, domain)));
    const successful = new Map<AppSyncDomainKey, SyncDomainResult<unknown>>();
    const failedDomains: AppSyncDomainKey[] = [];
    settled.forEach((result, index) => {
        const domain = selectedDomains[index];
        if (result.status === "fulfilled") successful.set(domain, result.value);
        else failedDomains.push(domain);
    });

    const canvas = successful.get("canvas") as SyncDomainResult<CanvasDomainData> | undefined;
    const folders = successful.get("canvas-folders") as SyncDomainResult<CanvasFoldersDomainData> | undefined;
    const assets = successful.get("assets") as SyncDomainResult<AssetDomainData> | undefined;
    const imageLogs = successful.get("image-workbench") as SyncDomainResult<LogDomainData> | undefined;
    const videoLogs = successful.get("video-workbench") as SyncDomainResult<LogDomainData> | undefined;
    const successfulResults = Array.from(successful.values());
    const result: AppSyncResult = {
        syncedAt: new Date().toISOString(),
        mergedRemote: successfulResults.some((item) => item.mergedRemote),
        projects: canvas?.data.projects.length ?? useCanvasStore.getState().projects.length,
        folders: folders?.data.folders.length ?? useCanvasFolderStore.getState().folders.length,
        assets: assets?.data.assets.length ?? useAssetStore.getState().assets.length,
        imageLogs: imageLogs?.data.logs.length ?? 0,
        videoLogs: videoLogs?.data.logs.length ?? 0,
        files: sumResults(successfulResults, "files"),
        manifestBytes: sumResults(successfulResults, "manifestBytes"),
        uploadedFiles: sumResults(successfulResults, "uploadedFiles"),
        uploadedBytes: sumResults(successfulResults, "uploadedBytes"),
        completedDomains: selectedDomains.filter((domain) => successful.has(domain)),
        failedDomains,
        weakConsistencyDomains: selectedDomains.filter((domain) => successful.get(domain)?.consistency === "weak"),
    };
    emitProgress(onProgress, { stage: failedDomains.length ? "partial" : "complete", status: failedDomains.length ? "exception" : "success" });
    return result;
}

async function syncSelectedDomain(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, domain: AppSyncDomainKey): Promise<SyncDomainResult<unknown>> {
    if (domain === "canvas") {
        await waitForHydration(useCanvasStore);
        return syncDomain<CanvasDomainData>(config, onProgress, {
            key: domain,
            localData: async () => ({ projects: useCanvasStore.getState().projects.map(normalizeCanvasProject) }),
            mergeData: (local, remote) => ({ projects: mergeById(local.projects, remote.projects, "updatedAt").map(normalizeCanvasProject) }),
            applyData: async (data) => {
                useCanvasStore.getState().replaceProjects(data.projects);
                await useCanvasStore.getState().flush();
            },
        });
    }
    if (domain === "canvas-folders") {
        await waitForHydration(useCanvasFolderStore);
        return syncDomain<CanvasFoldersDomainData>(config, onProgress, {
            key: domain,
            localData: async () => ({ folders: useCanvasFolderStore.getState().folders.map(normalizeCanvasFolder) }),
            mergeData: (local, remote) => ({ folders: mergeCanvasFolders(local.folders, remote.folders) }),
            applyData: async (data) => {
                useCanvasFolderStore.getState().replaceFolders(data.folders);
                await useCanvasFolderStore.getState().flush();
            },
        });
    }
    if (domain === "assets") {
        await waitForHydration(useAssetStore);
        return syncDomain<AssetDomainData>(config, onProgress, {
            key: domain,
            localData: async () => ({ assets: useAssetStore.getState().assets }),
            mergeData: (local, remote) => ({ assets: mergeById(local.assets, remote.assets, "updatedAt") }),
            applyData: async (data) => useAssetStore.getState().replaceAssets(await Promise.all(data.assets.map(hydrateAsset))),
        });
    }
    const store = domain === "image-workbench" ? imageLogStore : videoLogStore;
    return syncDomain<LogDomainData>(config, onProgress, {
        key: domain,
        localData: async () => ({ logs: await readStoredLogs(store) }),
        mergeData: (local, remote) => ({ logs: mergeById(local.logs, remote.logs, "createdAt") }),
        applyData: async (data) => replaceStoredLogs(store, data.logs),
    });
}

async function syncDomain<T>(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<T>): Promise<SyncDomainResult<T>> {
    try {
        emitProgress(onProgress, { domain: options.key, stage: "read-local", status: "active" });
        let mergedData = (await options.localData()) as T;
        let mergedRemote = false;
        let uploadedFiles = 0;
        let uploadedBytes = 0;

        for (let conflictRetries = 0; ; conflictRetries += 1) {
            emitProgress(onProgress, { domain: options.key, stage: "read-remote", current: conflictRetries, total: MAX_MANIFEST_CONFLICT_RETRIES, status: "active" });
            const remote = await readDomainManifest<T>(config, options.key);
            if (remote) {
                mergedRemote = true;
                mergedData = options.mergeData(mergedData, remote.manifest.data);
                emitProgress(onProgress, { domain: options.key, stage: "download-missing", status: "active" });
                await downloadMissingFiles(config, options.key, mergedData, remote.manifest.files, onProgress);
                emitProgress(onProgress, { domain: options.key, stage: "apply-merged", status: "active" });
                await options.applyData?.(mergedData);
            }

            emitProgress(onProgress, { domain: options.key, stage: "upload-new", status: "active" });
            const uploaded = await uploadChangedFiles(config, options.key, mergedData, remote?.manifest.files ?? [], onProgress);
            uploadedFiles += uploaded.uploadedFiles;
            uploadedBytes += uploaded.uploadedBytes;
            const manifest = createDomainManifest(options.key, mergedData, uploaded.files);
            const manifestFile = manifestBlob(manifest);
            emitProgress(onProgress, { domain: options.key, stage: "upload-manifest", bytes: manifestFile.size, status: "active" });
            try {
                const upload = await uploadWebdavFile(config, domainPath(options.key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json", remote?.etag ? { ifMatch: remote.etag } : remote ? {} : { ifNoneMatch: "*" });
                const weakConsistency = Boolean(remote && !remote.etag) || Boolean(!remote && !upload.etag);
                if (weakConsistency) {
                    emitProgress(onProgress, { domain: options.key, stage: "verify-write", status: "active" });
                    await verifyManifestWrite(config, options.key, manifest);
                    emitProgress(onProgress, { domain: options.key, stage: "weak-consistency", status: "active" });
                }
                emitProgress(onProgress, { domain: options.key, stage: "done", current: 1, total: 1, status: "success", consistency: weakConsistency ? "weak" : "etag" });
                return {
                    data: mergedData,
                    mergedRemote,
                    files: uploaded.files.length,
                    manifestBytes: manifestFile.size,
                    uploadedFiles,
                    uploadedBytes,
                    consistency: weakConsistency ? "weak" : "etag",
                };
            } catch (error) {
                if (!(error instanceof WebdavPreconditionFailedError)) throw error;
                if (conflictRetries >= MAX_MANIFEST_CONFLICT_RETRIES) throw new AppError("error.sync.conflictExhausted", { domain: options.key });
                emitProgress(onProgress, {
                    domain: options.key,
                    stage: "conflict-retry",
                    current: conflictRetries + 1,
                    total: MAX_MANIFEST_CONFLICT_RETRIES,
                    status: "active",
                });
            }
        }
    } catch (error) {
        emitProgress(onProgress, { domain: options.key, stage: "failed", detail: errorMessage(error), status: "exception" });
        throw error;
    }
}

export function parseAppSyncManifest(input: unknown, expectedDomain: AppSyncDomainKey): DomainManifest {
    const source = expectRecord(input, expectedDomain);
    if (source.app !== "infinite-canvas" || source.version !== 1 || source.domain !== expectedDomain) throw invalidManifest(expectedDomain);
    const commitId = parseCommitId(source.commitId, expectedDomain);
    const files = parseManifestFiles(source.files, expectedDomain);
    const exportedAt = typeof source.exportedAt === "string" ? source.exportedAt : "";
    let data: DomainManifest["data"];
    if (expectedDomain === "canvas") {
        const dataSource = expectRecord(source.data, expectedDomain);
        data = { projects: expectArray(dataSource.projects, expectedDomain).map((item) => parseCanvasProject(item, expectedDomain)) };
    } else if (expectedDomain === "canvas-folders") {
        const dataSource = expectRecord(source.data, expectedDomain);
        const folders = expectArray(dataSource.folders, expectedDomain).map((item) => parseCanvasFolder(item, expectedDomain));
        data = { folders: mergeCanvasFolders(folders) };
    } else if (expectedDomain === "assets") {
        const dataSource = expectRecord(source.data, expectedDomain);
        data = { assets: expectArray(dataSource.assets, expectedDomain).map((item) => parseIdentifiedRecord(item, expectedDomain)) };
    } else {
        const dataSource = expectRecord(source.data, expectedDomain);
        data = { logs: expectArray(dataSource.logs, expectedDomain).map((item) => parseIdentifiedRecord(item, expectedDomain)) };
    }
    return {
        app: "infinite-canvas",
        version: 1,
        domain: expectedDomain,
        exportedAt,
        ...(commitId ? { commitId } : {}),
        data,
        files,
    };
}

export function normalizeManifestBusinessContent(manifest: DomainManifest) {
    const data = normalizeDomainDataForComparison(manifest.domain, manifest.data);
    const files = [...manifest.files].sort((left, right) => left.storageKey.localeCompare(right.storageKey) || left.path.localeCompare(right.path));
    return stableStringify({ app: manifest.app, version: manifest.version, domain: manifest.domain, data, files });
}

async function readDomainManifest<T>(config: WebdavSyncConfig, domain: AppSyncDomainKey) {
    const download = await downloadWebdavFileWithMetadata(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!download) return null;
    let input: unknown;
    try {
        input = JSON.parse(await download.file.text());
    } catch {
        throw invalidManifest(domain);
    }
    return { manifest: parseAppSyncManifest(input, domain) as DomainManifest<T>, etag: download.etag };
}

async function verifyManifestWrite(config: WebdavSyncConfig, domain: AppSyncDomainKey, expected: DomainManifest) {
    const actual = await readDomainManifest(config, domain);
    if (!actual || actual.manifest.commitId !== expected.commitId) throw new AppError("error.sync.writeVerificationFailed", { domain });
    if (normalizeManifestBusinessContent(actual.manifest) !== normalizeManifestBusinessContent(expected)) throw new AppError("error.sync.writeVerificationFailed", { domain });
}

function createDomainManifest<T>(domain: AppSyncDomainKey, data: T, files: AppSyncFile[]): DomainManifest<T> {
    return { app: "infinite-canvas", version: 1, domain, exportedAt: new Date().toISOString(), commitId: createCommitId(), data, files };
}

function createCommitId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function manifestBlob(manifest: DomainManifest) {
    return new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
}

async function downloadMissingFiles<T>(config: WebdavSyncConfig, domain: AppSyncDomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const tasks: AppSyncFile[] = [];
    const storageKeys = collectStorageKeysForDomain(domain, data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const localBlob = storageKey.startsWith("image:") || storageKey.startsWith("canvas-cover:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        scanned += 1;
        if (localBlob) {
            emitProgress(onProgress, { domain, stage: "scan-missing", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const remoteFile = remoteFileMap.get(storageKey);
        if (remoteFile) tasks.push(remoteFile);
        emitProgress(onProgress, { domain, stage: "scan-missing", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        emitProgress(onProgress, { domain, stage: "media-complete", current: 1, total: 1, status: "active" });
        return;
    }
    let downloaded = 0;
    await runWithConcurrency(tasks, FILE_CONCURRENCY, async (remoteFile) => {
        const blob = await downloadWebdavFile(config, remoteFile.path);
        if (!blob || blob.size !== remoteFile.bytes) throw new AppError("error.sync.invalidManifest", { domain });
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, remoteFile.mimeType);
        const imageBlob = remoteFile.storageKey.startsWith("image:") || remoteFile.storageKey.startsWith("canvas-cover:");
        await (imageBlob ? setImageBlob(remoteFile.storageKey, typedBlob) : setMediaBlob(remoteFile.storageKey, typedBlob));
        downloaded += 1;
        emitProgress(onProgress, { domain, stage: "download-media", current: downloaded, total: tasks.length, status: "active" });
    });
}

async function uploadChangedFiles<T>(config: WebdavSyncConfig, domain: AppSyncDomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const files: AppSyncFile[] = [];
    const tasks: Array<{ item: AppSyncFile; blob: Blob }> = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;
    const storageKeys = collectStorageKeysForDomain(domain, data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const imageBlob = storageKey.startsWith("image:") || storageKey.startsWith("canvas-cover:");
        const blob = imageBlob ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        const remoteFile = remoteFileMap.get(storageKey);
        if (!blob) {
            if (remoteFile) files.push(remoteFile);
            scanned += 1;
            emitProgress(onProgress, { domain, stage: "scan-local", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const item: AppSyncFile = {
            storageKey,
            path: remoteFile?.path || domainPath(domain, `files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`),
            mimeType: blob.type || remoteFile?.mimeType || "application/octet-stream",
            bytes: blob.size,
        };
        files.push(item);
        if (!remoteFile || remoteFile.bytes !== blob.size) tasks.push({ item, blob });
        scanned += 1;
        emitProgress(onProgress, { domain, stage: "scan-local", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        emitProgress(onProgress, { domain, stage: "no-upload", current: 1, total: 1, status: "active" });
        return { files, uploadedFiles, uploadedBytes };
    }
    await runWithConcurrency(tasks, FILE_CONCURRENCY, async ({ item, blob }) => {
        await uploadWebdavFile(config, item.path, blob, item.mimeType);
        uploadedFiles += 1;
        uploadedBytes += blob.size;
        emitProgress(onProgress, { domain, stage: "upload-media", bytes: blob.size, current: uploadedFiles, total: tasks.length, status: "active" });
    });
    return { files, uploadedFiles, uploadedBytes };
}

export function collectStorageKeysForDomain(domain: AppSyncDomainKey, value: unknown) {
    const keys = new Set(collectStorageKeys(value).filter((key) => domain !== "canvas" || !key.startsWith("canvas-cover:")));
    if (domain === "canvas") {
        const projects = (value as Partial<CanvasDomainData>)?.projects;
        projects?.forEach((project) => {
            if (project.coverStorageKey?.startsWith(`canvas-cover:${project.id}:`)) keys.add(project.coverStorageKey);
        });
    }
    return [...keys].sort();
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

async function readStoredLogs(store: LogStore) {
    const logs: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    return logs;
}

async function replaceStoredLogs(store: LogStore, logs: StoredLog[]) {
    await store.replaceItems(logs.map((log) => ({ key: getStringField(log, "id"), value: log })).filter((item) => item.key));
}

function mergeById<T extends { id?: string }>(local: T[], remote: T[], timeKey: string) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        const id = item.id || "";
        if (id) items.set(id, item);
    });
    local.forEach((item) => {
        const id = item.id || "";
        if (!id) return;
        const current = items.get(id);
        if (!current || getTime(item as Record<string, unknown>, timeKey) >= getTime(current as Record<string, unknown>, timeKey)) items.set(id, item);
    });
    return Array.from(items.values()).sort((a, b) => getTime(b as Record<string, unknown>, timeKey) - getTime(a as Record<string, unknown>, timeKey) || String(a.id).localeCompare(String(b.id)));
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function parseCanvasProject(input: unknown, domain: AppSyncDomainKey) {
    const source = expectRecord(input, domain);
    if (!isNonEmptyString(source.id) || typeof source.title !== "string" || typeof source.createdAt !== "string" || typeof source.updatedAt !== "string" || !Array.isArray(source.nodes) || !Array.isArray(source.connections)) {
        throw invalidManifest(domain);
    }
    return normalizeCanvasProject(source);
}

function parseCanvasFolder(input: unknown, domain: AppSyncDomainKey) {
    const source = expectRecord(input, domain);
    if (
        !isNonEmptyString(source.id) ||
        typeof source.name !== "string" ||
        typeof source.createdAt !== "string" ||
        typeof source.updatedAt !== "string" ||
        !(source.parentId === null || typeof source.parentId === "string" || source.parentId === undefined) ||
        !(source.deletedAt === undefined || typeof source.deletedAt === "string")
    ) {
        throw invalidManifest(domain);
    }
    return normalizeCanvasFolder(source);
}

function parseIdentifiedRecord(input: unknown, domain: AppSyncDomainKey) {
    const source = expectRecord(input, domain);
    if (!isNonEmptyString(source.id)) throw invalidManifest(domain);
    return source as Asset & StoredLog;
}

function parseManifestFiles(input: unknown, domain: AppSyncDomainKey) {
    return expectArray(input, domain).map((item) => {
        const source = expectRecord(item, domain);
        if (!isNonEmptyString(source.storageKey) || !isNonEmptyString(source.path) || !isNonEmptyString(source.mimeType) || typeof source.bytes !== "number" || !Number.isFinite(source.bytes) || source.bytes < 0) {
            throw invalidManifest(domain);
        }
        return { storageKey: source.storageKey, path: source.path, mimeType: source.mimeType, bytes: source.bytes };
    });
}

function parseCommitId(input: unknown, domain: AppSyncDomainKey) {
    if (input === undefined) return undefined;
    if (typeof input !== "string") throw invalidManifest(domain);
    const commitId = input.trim();
    if (!commitId || commitId.length > 128) throw invalidManifest(domain);
    return commitId;
}

function normalizeDomainDataForComparison(domain: AppSyncDomainKey, data: unknown) {
    const source = data as Record<string, unknown[]>;
    if (domain === "canvas") return { projects: [...(source.projects ?? [])].sort(compareRecordIds) };
    if (domain === "canvas-folders") return { folders: [...(source.folders ?? [])].sort(compareRecordIds) };
    if (domain === "assets") return { assets: [...(source.assets ?? [])].sort(compareRecordIds) };
    return { logs: [...(source.logs ?? [])].sort(compareRecordIds) };
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        const source = value as Record<string, unknown>;
        return `{${Object.keys(source)
            .filter((key) => source[key] !== undefined)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(source[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function expectRecord(input: unknown, domain: AppSyncDomainKey): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidManifest(domain);
    return input as Record<string, unknown>;
}

function expectArray(input: unknown, domain: AppSyncDomainKey) {
    if (!Array.isArray(input)) throw invalidManifest(domain);
    return input;
}

function invalidManifest(domain: AppSyncDomainKey) {
    return new AppError("error.sync.invalidManifest", { domain });
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function compareRecordIds(left: unknown, right: unknown) {
    return getStringField(left as Record<string, unknown>, "id").localeCompare(getStringField(right as Record<string, unknown>, "id"));
}

function domainPath(domain: AppSyncDomainKey, path: string) {
    return `${domain}/${path}`;
}

function emitProgress(onProgress: AppSyncProgress | undefined, event: AppSyncProgressEvent) {
    onProgress?.(event);
}

function getStringField(item: Record<string, unknown>, key: string) {
    const value = item[key];
    return typeof value === "string" ? value : "";
}

function getTime(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value) || 0;
    return 0;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") || storageKey.startsWith("canvas-cover:") ? "png" : "bin";
}

function waitForHydration<T extends { hydrated: boolean; hydrationStatus?: string; lastError?: string }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    const initial = store.getState();
    if (initial.hydrated) return Promise.resolve();
    if (initial.hydrationStatus === "error") return Promise.reject(new Error(initial.lastError || "Local data hydration failed"));
    return new Promise<void>((resolve, reject) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated && state.hydrationStatus !== "error") return;
            unsubscribe();
            if (state.hydrated) resolve();
            else reject(new Error(state.lastError || "Local data hydration failed"));
        });
    });
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await worker(items[index], index);
            }
        }),
    );
    return results;
}

function sumResults(results: SyncDomainResult<unknown>[], key: "files" | "manifestBytes" | "uploadedFiles" | "uploadedBytes") {
    return results.reduce((total, result) => total + result[key], 0);
}

function errorMessage(error: unknown) {
    return error instanceof Error && !(error instanceof AppError) ? error.message : undefined;
}
