import { nanoid } from "nanoid";

import { normalizeZipPath } from "@/lib/zip";
import type { CanvasArchiveFolder, CanvasArchiveProject, CanvasExportAsset, CanvasExportFile, CanvasExportFileV4, CanvasProjectExportItem } from "@/types/canvas-export";

const MAX_FOLDER_ANCESTORS = 10_000;

export type ParsedCanvasArchive = {
    manifest: CanvasExportFile;
    files: Map<string, Blob>;
};

export type CanvasArchiveRemap = {
    projectIds: Map<string, string>;
    folderIds: Map<string, string>;
    storageKeys: Map<string, string>;
};

export type CanvasArchiveRemapFactories = {
    projectId?: (oldId: string) => string;
    folderId?: (oldId: string) => string;
    storageKey?: (oldKey: string, projectId?: string) => string;
};

export async function parseCanvasArchive(zip: Map<string, Blob>): Promise<ParsedCanvasArchive> {
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error("Canvas archive is missing projects.json");

    let input: unknown;
    try {
        input = JSON.parse(await projectFile.text());
    } catch {
        throw new Error("Canvas archive projects.json is not valid JSON");
    }
    const manifest = parseCanvasExportFile(input);
    const declaredPaths = new Set<string>();
    const storageAssets = new Map<string, CanvasExportAsset>();
    const coverOwners = new Map<string, string>();

    for (const item of manifest.projects) {
        const coverStorageKey = item.project.coverStorageKey;
        if (coverStorageKey) {
            const owner = coverOwners.get(coverStorageKey);
            if (owner && owner !== item.project.id) throw new Error(`Canvas archive cover key is shared by multiple projects: ${coverStorageKey}`);
            coverOwners.set(coverStorageKey, item.project.id);
        }
        for (const asset of item.files) {
            if (declaredPaths.has(asset.path)) throw new Error(`Canvas archive contains a duplicate asset path: ${asset.path}`);
            declaredPaths.add(asset.path);
            const previous = storageAssets.get(asset.storageKey);
            if (previous && (previous.path !== asset.path || previous.bytes !== asset.bytes || previous.mimeType !== asset.mimeType)) {
                throw new Error(`Canvas archive storage key has conflicting assets: ${asset.storageKey}`);
            }
            storageAssets.set(asset.storageKey, asset);
            const blob = zip.get(asset.path);
            if (!blob) throw new Error(`Canvas archive is missing asset: ${asset.path}`);
            if (blob.size !== asset.bytes) throw new Error(`Canvas archive asset size mismatch: ${asset.path}`);
        }
        if (coverStorageKey && !item.files.some((asset) => asset.storageKey === coverStorageKey)) {
            throw new Error(`Canvas archive is missing cover asset: ${coverStorageKey}`);
        }
    }

    return { manifest, files: zip };
}

export function parseCanvasExportFile(input: unknown): CanvasExportFile {
    const root = requireRecord(input, "archive");
    if (root.app !== "infinite-canvas") throw new Error("Unsupported canvas archive app");
    if (root.version !== 3 && root.version !== 4) throw new Error("Unsupported canvas archive version");
    if (typeof root.exportedAt !== "string" || !root.exportedAt) throw new Error("Canvas archive exportedAt must be a non-empty string");
    if (!Array.isArray(root.projects)) throw new Error("Canvas archive projects must be an array");

    const projectIds = new Set<string>();
    const projects = root.projects.map((value, index) => {
        const item = requireRecord(value, `projects[${index}]`);
        const project = parseProject(item.project, `projects[${index}].project`);
        if (projectIds.has(project.id)) throw new Error(`Canvas archive contains duplicate project id: ${project.id}`);
        projectIds.add(project.id);
        if (!Array.isArray(item.files)) throw new Error(`Canvas archive projects[${index}].files must be an array`);
        return { project, files: item.files.map((asset, assetIndex) => parseAsset(asset, `projects[${index}].files[${assetIndex}]`)) };
    });

    if (root.version === 3) return { app: "infinite-canvas", version: 3, exportedAt: root.exportedAt, projects };
    if (root.folders !== undefined && !Array.isArray(root.folders)) throw new Error("Canvas archive folders must be an array");
    const folderIds = new Set<string>();
    const folders = (root.folders || []).map((value, index) => {
        const folder = parseFolder(value, `folders[${index}]`);
        if (folderIds.has(folder.id)) throw new Error(`Canvas archive contains duplicate folder id: ${folder.id}`);
        folderIds.add(folder.id);
        return folder;
    });
    validateFolderGraph(folders);
    for (const item of projects) {
        if (item.project.folderId && !folderIds.has(item.project.folderId)) throw new Error(`Canvas archive project references a missing folder: ${item.project.folderId}`);
    }
    return { app: "infinite-canvas", version: 4, exportedAt: root.exportedAt, projects, folders };
}

export function collectCanvasProjectStorageKeys(project: CanvasProjectLibraryFields, keys = new Set<string>()) {
    if (typeof project.coverStorageKey === "string" && project.coverStorageKey) keys.add(project.coverStorageKey);
    collectNestedStorageKeys(project, keys, new WeakSet<object>());
    return [...keys];
}

export function collectExportFolderAncestors(projects: CanvasProjectLibraryFields[], folders: CanvasArchiveFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const included = new Set<string>();
    for (const project of projects) {
        let folderId = typeof project.folderId === "string" ? project.folderId : null;
        const visited = new Set<string>();
        for (let depth = 0; folderId && depth < MAX_FOLDER_ANCESTORS; depth += 1) {
            if (visited.has(folderId)) break;
            visited.add(folderId);
            const folder = byId.get(folderId);
            if (!folder) break;
            if (!folder.deletedAt) included.add(folder.id);
            folderId = folder.parentId;
        }
    }
    return folders.filter((folder) => included.has(folder.id) && !folder.deletedAt);
}

export function createCanvasArchiveRemap(manifest: CanvasExportFile, factories: CanvasArchiveRemapFactories = {}): CanvasArchiveRemap {
    const projectIds = new Map<string, string>();
    const folderIds = new Map<string, string>();
    const storageKeys = new Map<string, string>();
    const projectIdFactory = factories.projectId || (() => nanoid());
    const folderIdFactory = factories.folderId || (() => nanoid());

    for (const item of manifest.projects) projectIds.set(item.project.id, projectIdFactory(item.project.id));
    if (manifest.version === 4) for (const folder of manifest.folders || []) folderIds.set(folder.id, folderIdFactory(folder.id));
    for (const item of manifest.projects) {
        for (const asset of item.files) {
            if (storageKeys.has(asset.storageKey)) continue;
            storageKeys.set(asset.storageKey, factories.storageKey?.(asset.storageKey, projectIds.get(item.project.id)) || defaultRemappedStorageKey(asset.storageKey, projectIds.get(item.project.id)));
        }
        const cover = item.project.coverStorageKey;
        if (cover && !storageKeys.has(cover)) storageKeys.set(cover, factories.storageKey?.(cover, projectIds.get(item.project.id)) || defaultRemappedStorageKey(cover, projectIds.get(item.project.id)));
    }
    return { projectIds, folderIds, storageKeys };
}

export function remapCanvasArchive(manifest: CanvasExportFile, remap: CanvasArchiveRemap): CanvasExportFileV4 {
    const folders = manifest.version === 4 ? manifest.folders || [] : [];
    return {
        app: "infinite-canvas",
        version: 4,
        exportedAt: manifest.exportedAt,
        folders: folders.map((folder) => ({ ...folder, id: remap.folderIds.get(folder.id) || folder.id, parentId: folder.parentId ? remap.folderIds.get(folder.parentId) || null : null })),
        projects: manifest.projects.map((item) => remapProjectItem(item, remap, manifest.version)),
    };
}

type CanvasProjectLibraryFields = CanvasArchiveProject | (Record<string, unknown> & { folderId?: string | null; coverStorageKey?: string });

function remapProjectItem(item: CanvasProjectExportItem, remap: CanvasArchiveRemap, sourceVersion: 3 | 4): CanvasProjectExportItem {
    const project = replaceStorageKeys(item.project, remap.storageKeys) as CanvasArchiveProject;
    project.id = remap.projectIds.get(item.project.id) || item.project.id;
    project.folderId = sourceVersion === 4 && item.project.folderId ? remap.folderIds.get(item.project.folderId) || null : null;
    if (item.project.coverStorageKey) project.coverStorageKey = remap.storageKeys.get(item.project.coverStorageKey) || item.project.coverStorageKey;
    return {
        project,
        files: item.files.map((asset) => ({ ...asset, storageKey: remap.storageKeys.get(asset.storageKey) || asset.storageKey })),
    };
}

function parseProject(value: unknown, label: string) {
    const project = requireRecord(value, label);
    requireString(project.id, `${label}.id`);
    requireString(project.title, `${label}.title`, true);
    requireString(project.createdAt, `${label}.createdAt`);
    requireString(project.updatedAt, `${label}.updatedAt`);
    if (!Array.isArray(project.nodes)) throw new Error(`${label}.nodes must be an array`);
    if (!Array.isArray(project.connections)) throw new Error(`${label}.connections must be an array`);
    if (!Array.isArray(project.chatSessions)) throw new Error(`${label}.chatSessions must be an array`);
    if (project.activeChatId !== null && typeof project.activeChatId !== "string") throw new Error(`${label}.activeChatId must be a string or null`);
    requireString(project.backgroundMode, `${label}.backgroundMode`);
    if (typeof project.showImageInfo !== "boolean") throw new Error(`${label}.showImageInfo must be a boolean`);
    const viewport = requireRecord(project.viewport, `${label}.viewport`);
    for (const field of ["x", "y", "k"] as const) {
        if (typeof viewport[field] !== "number" || !Number.isFinite(viewport[field])) throw new Error(`${label}.viewport.${field} must be a finite number`);
    }
    if (project.folderId !== undefined && project.folderId !== null && typeof project.folderId !== "string") throw new Error(`${label}.folderId must be a string or null`);
    if (project.isDefault !== undefined && typeof project.isDefault !== "boolean") throw new Error(`${label}.isDefault must be a boolean`);
    if (project.coverStorageKey !== undefined && (typeof project.coverStorageKey !== "string" || !project.coverStorageKey)) throw new Error(`${label}.coverStorageKey must be a non-empty string`);
    if (project.coverUpdatedAt !== undefined) requireString(project.coverUpdatedAt, `${label}.coverUpdatedAt`);
    return project as CanvasArchiveProject;
}

function parseFolder(value: unknown, label: string): CanvasArchiveFolder {
    const folder = requireRecord(value, label);
    requireString(folder.id, `${label}.id`);
    requireString(folder.name, `${label}.name`);
    if (folder.parentId !== null && typeof folder.parentId !== "string") throw new Error(`${label}.parentId must be a string or null`);
    requireString(folder.createdAt, `${label}.createdAt`);
    requireString(folder.updatedAt, `${label}.updatedAt`);
    if (folder.deletedAt !== undefined) requireString(folder.deletedAt, `${label}.deletedAt`);
    return folder as CanvasArchiveFolder;
}

function parseAsset(value: unknown, label: string): CanvasExportAsset {
    const asset = requireRecord(value, label);
    const storageKey = requireString(asset.storageKey, `${label}.storageKey`);
    if (!storageKey.includes(":")) throw new Error(`${label}.storageKey must include a namespace`);
    const mimeType = requireString(asset.mimeType, `${label}.mimeType`);
    if (typeof asset.bytes !== "number" || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) throw new Error(`${label}.bytes must be a non-negative safe integer`);
    const path = normalizeZipPath(requireString(asset.path, `${label}.path`));
    return { storageKey, path, mimeType, bytes: asset.bytes };
}

function validateFolderGraph(folders: CanvasArchiveFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    for (const folder of folders) {
        const visited = new Set<string>();
        let current: CanvasArchiveFolder | undefined = folder;
        for (let depth = 0; current?.parentId; depth += 1) {
            if (depth >= MAX_FOLDER_ANCESTORS || visited.has(current.id)) throw new Error(`Canvas archive folder cycle: ${folder.id}`);
            visited.add(current.id);
            const parent = byId.get(current.parentId);
            if (!parent) throw new Error(`Canvas archive folder references a missing parent: ${current.parentId}`);
            current = parent;
        }
    }
}

function collectNestedStorageKeys(value: unknown, keys: Set<string>, visited: WeakSet<object>) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach((item) => collectNestedStorageKeys(item, keys, visited));
        else collectNestedStorageKeys(child, keys, visited);
    }
}

function replaceStorageKeys<T>(value: T, storageKeys: Map<string, string>, visited = new WeakMap<object, unknown>()): T {
    if (!value || typeof value !== "object") return value;
    const existing = visited.get(value);
    if (existing) return existing as T;
    if (Array.isArray(value)) {
        const result: unknown[] = [];
        visited.set(value, result);
        value.forEach((item) => result.push(replaceStorageKeys(item, storageKeys, visited)));
        return result as T;
    }
    const result: Record<string, unknown> = {};
    visited.set(value, result);
    for (const [key, child] of Object.entries(value)) {
        result[key] = key === "storageKey" && typeof child === "string" ? storageKeys.get(child) || child : replaceStorageKeys(child, storageKeys, visited);
    }
    return result as T;
}

function defaultRemappedStorageKey(oldKey: string, projectId?: string) {
    if (oldKey.startsWith("canvas-cover:")) return `canvas-cover:${projectId || nanoid()}:${nanoid()}`;
    const separator = oldKey.indexOf(":");
    return `${separator > 0 ? oldKey.slice(0, separator) : "asset"}:${nanoid()}`;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, allowEmpty = false) {
    if (typeof value !== "string" || (!allowEmpty && !value)) throw new Error(`${label} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
    return value;
}
