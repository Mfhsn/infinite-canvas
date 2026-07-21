import { findNearestActiveFolder, MAX_FOLDER_TRAVERSAL } from "@/lib/canvas/canvas-library";
import type { CanvasFolder, CanvasProject } from "@/types/canvas-library";

export type CanvasProjectSwitcherView = {
    currentFolder: CanvasFolder | null;
    breadcrumbs: CanvasFolder[];
    folders: CanvasFolder[];
    projects: CanvasProject[];
};

export function getCanvasProjectSwitcherView(folderId: string | null, projects: CanvasProject[], folders: CanvasFolder[]): CanvasProjectSwitcherView {
    const effectiveFolders = folders
        .filter((folder) => !folder.deletedAt)
        .map((folder) => ({
            ...folder,
            parentId: findNearestActiveFolder(folder.parentId, folders).folderId,
        }));

    return {
        currentFolder: folderId ? (effectiveFolders.find((folder) => folder.id === folderId) ?? null) : null,
        breadcrumbs: buildBreadcrumbs(folderId, effectiveFolders),
        folders: effectiveFolders.filter((folder) => folder.parentId === folderId).sort(compareFolders),
        projects: projects.filter((project) => findNearestActiveFolder(project.folderId, folders).folderId === folderId).sort(compareProjects),
    };
}

function buildBreadcrumbs(folderId: string | null, folders: CanvasFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result: CanvasFolder[] = [];
    const visited = new Set<string>();
    let currentId = folderId;

    for (let depth = 0; currentId && depth < MAX_FOLDER_TRAVERSAL; depth += 1) {
        if (visited.has(currentId)) break;
        visited.add(currentId);
        const folder = byId.get(currentId);
        if (!folder) break;
        result.unshift(folder);
        currentId = folder.parentId;
    }

    return result;
}

function compareFolders(left: CanvasFolder, right: CanvasFolder) {
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function compareProjects(left: CanvasProject, right: CanvasProject) {
    return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
