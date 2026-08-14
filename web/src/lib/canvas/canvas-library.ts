import type { CanvasFolder, CanvasProject } from "@/types/canvas-library";
import { stripPlatformSessionBinding } from "@/services/platform-session";

export const MAX_FOLDER_TRAVERSAL = 1_000;
const INITIAL_VIEWPORT = { x: 0, y: 0, k: 1 } as const;

function record(input: unknown): Record<string, unknown> {
    return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = "") {
    return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayValue<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function isCanvasCoverKey(value: unknown, projectId: string): value is string {
    return typeof value === "string" && value.startsWith(`canvas-cover:${projectId}:`) && value.length > `canvas-cover:${projectId}:`.length;
}

function stripNodeSessionBinding(node: CanvasProject["nodes"][number]) {
    if (!node?.metadata?.storageKey || !node.metadata.content) return node;
    const content = stripPlatformSessionBinding(node.metadata.content);
    return content === node.metadata.content ? node : { ...node, metadata: { ...node.metadata, content } };
}

function stripChatSessionBindings(session: CanvasProject["chatSessions"][number]) {
    if (!session?.messages) return session;
    let changed = false;
    const messages = session.messages.map((message) => {
        if (!message?.references?.length) return message;
        let referencesChanged = false;
        const references = message.references.map((reference) => {
            if (!reference?.storageKey || !reference.dataUrl) return reference;
            const dataUrl = stripPlatformSessionBinding(reference.dataUrl);
            if (dataUrl === reference.dataUrl) return reference;
            referencesChanged = true;
            return { ...reference, dataUrl };
        });
        if (!referencesChanged) return message;
        changed = true;
        return { ...message, references };
    });
    return changed ? { ...session, messages } : session;
}

export function normalizeCanvasProject(input: unknown): CanvasProject {
    const source = record(input);
    const id = stringValue(source.id);
    const viewport = record(source.viewport);
    const coverStorageKey = isCanvasCoverKey(source.coverStorageKey, id) ? source.coverStorageKey : undefined;
    const coverUpdatedAt = coverStorageKey ? optionalString(source.coverUpdatedAt) : undefined;
    return {
        id,
        title: stringValue(source.title),
        createdAt: stringValue(source.createdAt),
        updatedAt: stringValue(source.updatedAt),
        nodes: stringArrayValue<CanvasProject["nodes"][number]>(source.nodes).map(stripNodeSessionBinding),
        connections: stringArrayValue<CanvasProject["connections"][number]>(source.connections),
        chatSessions: stringArrayValue<CanvasProject["chatSessions"][number]>(source.chatSessions).map(stripChatSessionBindings),
        activeChatId: typeof source.activeChatId === "string" ? source.activeChatId : null,
        backgroundMode: source.backgroundMode === "dots" || source.backgroundMode === "lines" || source.backgroundMode === "blank" ? source.backgroundMode : "lines",
        showImageInfo: source.showImageInfo === true,
        viewport: {
            x: typeof viewport.x === "number" && Number.isFinite(viewport.x) ? viewport.x : INITIAL_VIEWPORT.x,
            y: typeof viewport.y === "number" && Number.isFinite(viewport.y) ? viewport.y : INITIAL_VIEWPORT.y,
            k: typeof viewport.k === "number" && Number.isFinite(viewport.k) ? viewport.k : INITIAL_VIEWPORT.k,
        },
        folderId: typeof source.folderId === "string" && source.folderId.length > 0 ? source.folderId : null,
        isDefault: source.isDefault === true,
        ...(coverStorageKey ? { coverStorageKey } : {}),
        ...(coverUpdatedAt ? { coverUpdatedAt } : {}),
    };
}

export function normalizeCanvasFolder(input: unknown): CanvasFolder {
    const source = record(input);
    const deletedAt = optionalString(source.deletedAt);
    return {
        id: stringValue(source.id),
        name: stringValue(source.name).trim(),
        parentId: typeof source.parentId === "string" && source.parentId.length > 0 ? source.parentId : null,
        createdAt: stringValue(source.createdAt),
        updatedAt: stringValue(source.updatedAt),
        ...(deletedAt ? { deletedAt } : {}),
    };
}

export function compareCanvasFolders(left: CanvasFolder, right: CanvasFolder) {
    return left.name.localeCompare(right.name) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function newerFolder(left: CanvasFolder, right: CanvasFolder) {
    const leftDeleted = Boolean(left.deletedAt);
    const rightDeleted = Boolean(right.deletedAt);
    if (leftDeleted !== rightDeleted) return leftDeleted ? left : right;
    const leftClock = leftDeleted ? `${left.deletedAt}\u0000${left.updatedAt}` : left.updatedAt;
    const rightClock = rightDeleted ? `${right.deletedAt}\u0000${right.updatedAt}` : right.updatedAt;
    if (leftClock !== rightClock) return leftClock > rightClock ? left : right;
    return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
}

export function mergeCanvasFolders(...collections: CanvasFolder[][]) {
    const byId = new Map<string, CanvasFolder>();
    collections
        .flat()
        .map(normalizeCanvasFolder)
        .forEach((folder) => {
            const current = byId.get(folder.id);
            byId.set(folder.id, current ? newerFolder(current, folder) : folder);
        });
    return Array.from(byId.values()).sort(compareCanvasFolders);
}

export type FolderResolutionDiagnostic = "missing-folder" | "folder-cycle" | "traversal-limit";

export function findNearestActiveFolder(folderId: string | null | undefined, folders: CanvasFolder[]): { folderId: string | null; diagnostic?: FolderResolutionDiagnostic } {
    if (!folderId) return { folderId: null };
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const visited = new Set<string>();
    let currentId: string | null = folderId;
    for (let depth = 0; currentId && depth < MAX_FOLDER_TRAVERSAL; depth += 1) {
        if (visited.has(currentId)) return { folderId: null, diagnostic: "folder-cycle" };
        visited.add(currentId);
        const folder = byId.get(currentId);
        if (!folder) return { folderId: null, diagnostic: "missing-folder" };
        if (!folder.deletedAt) return { folderId: folder.id };
        currentId = folder.parentId;
    }
    return currentId ? { folderId: null, diagnostic: "traversal-limit" } : { folderId: null };
}

export function wouldCreateFolderCycle(folders: CanvasFolder[], folderId: string, parentId: string | null) {
    if (!parentId) return false;
    if (folderId === parentId) return true;
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const visited = new Set<string>();
    let currentId: string | null = parentId;
    for (let depth = 0; currentId && depth < MAX_FOLDER_TRAVERSAL; depth += 1) {
        if (currentId === folderId || visited.has(currentId)) return true;
        visited.add(currentId);
        currentId = byId.get(currentId)?.parentId ?? null;
    }
    return currentId !== null;
}

export function collectFolderDescendantIds(folderId: string, folders: CanvasFolder[]) {
    const children = new Map<string, string[]>();
    folders.forEach((folder) => {
        if (!folder.parentId) return;
        children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder.id]);
    });
    const descendants: string[] = [];
    const visited = new Set([folderId]);
    const queue = [...(children.get(folderId) ?? [])];
    while (queue.length && visited.size <= MAX_FOLDER_TRAVERSAL) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        descendants.push(id);
        queue.push(...(children.get(id) ?? []));
    }
    return descendants.sort();
}
