import { saveAs } from "file-saver";

import { collectCanvasProjectStorageKeys, collectExportFolderAncestors } from "@/lib/canvas/canvas-archive";
import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasArchiveFolder, CanvasExportAsset, CanvasExportFileV4 } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type ExportableCanvasProject = CanvasProject & {
    folderId?: string | null;
    isDefault?: boolean;
    coverStorageKey?: string;
    coverUpdatedAt?: string;
};

export async function exportCanvasProjects(projects: ExportableCanvasProject[], fileName = "infinite-canvas", folders: CanvasArchiveFolder[] = []) {
    const zip = await createCanvasProjectsArchive(projects, folders);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function createCanvasProjectsArchive(projects: ExportableCanvasProject[], folders: CanvasArchiveFolder[] = []) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            const storageKeys = collectCanvasProjectStorageKeys(project);
            await Promise.all(
                storageKeys.map(async (storageKey, index) => {
                    const blob = storageKey.startsWith("image:") || storageKey.startsWith("canvas-cover:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (!blob) return;
                    const path = `projects/${safePathSegment(project.id)}/files/${index}-${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            files.sort((left, right) => left.path.localeCompare(right.path));
            return { project: { ...project, folderId: project.folderId ?? null, isDefault: project.isDefault ?? false }, files };
        }),
    );

    const data: CanvasExportFileV4 = {
        app: "infinite-canvas",
        version: 4,
        exportedAt: new Date().toISOString(),
        projects: exportedProjects,
        folders: collectExportFolderAncestors(projects, folders),
    };
    return await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|\0]/g, "_");
}

function safePathSegment(value: string) {
    return encodeURIComponent(value).replace(/\./g, "%2E");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return storageKey.startsWith("image:") || storageKey.startsWith("canvas-cover:") ? "png" : "bin";
}
