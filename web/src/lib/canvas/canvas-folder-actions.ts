import { collectFolderDescendantIds, findNearestActiveFolder } from "@/lib/canvas/canvas-library";
import type { CanvasFolder, CanvasProject } from "@/types/canvas-library";

export type FolderDeletionImpact = {
    folderId: string;
    promotedToFolderId: string | null;
    directFolderIds: string[];
    directProjectIds: string[];
    affectedFolderIds: string[];
    affectedProjectIds: string[];
    totalResourceCount: number;
};

export function getFolderDeletionImpact(folderId: string, folders: CanvasFolder[], projects: CanvasProject[]): FolderDeletionImpact {
    const folder = folders.find((item) => item.id === folderId);
    const affectedFolderIds = collectFolderDescendantIds(folderId, folders);
    const affectedIds = new Set([folderId, ...affectedFolderIds]);
    const directFolderIds = folders
        .filter((item) => item.parentId === folderId && !item.deletedAt)
        .map((item) => item.id)
        .sort();
    const directProjectIds = projects
        .filter((project) => project.folderId === folderId)
        .map((project) => project.id)
        .sort();
    const affectedProjectIds = projects
        .filter((project) => project.folderId && affectedIds.has(project.folderId))
        .map((project) => project.id)
        .sort();
    return {
        folderId,
        promotedToFolderId: findNearestActiveFolder(folder?.parentId ?? null, folders).folderId,
        directFolderIds,
        directProjectIds,
        affectedFolderIds,
        affectedProjectIds,
        totalResourceCount: affectedFolderIds.length + affectedProjectIds.length,
    };
}

export function applyFolderDeletionToProjects(projects: CanvasProject[], impact: FolderDeletionImpact) {
    const affected = new Set(impact.directProjectIds);
    return projects.map((project) => (affected.has(project.id) ? { ...project, folderId: impact.promotedToFolderId } : project));
}

export function applyFolderDeletionToFolders(folders: CanvasFolder[], impact: FolderDeletionImpact) {
    const affected = new Set(impact.directFolderIds);
    return folders.map((folder) => (affected.has(folder.id) ? { ...folder, parentId: impact.promotedToFolderId } : folder));
}
