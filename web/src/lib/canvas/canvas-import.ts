import { createCanvasArchiveRemap, parseCanvasArchive, remapCanvasArchive } from "@/lib/canvas/canvas-archive";
import { normalizeCanvasFolder, normalizeCanvasProject } from "@/lib/canvas/canvas-library";
import { deleteStoredMedia, setMediaBlob } from "@/services/file-storage";
import { deleteStoredImages, setImageBlob } from "@/services/image-storage";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export class CanvasArchiveImportError extends Error {
    constructor(
        message: string,
        readonly writtenFiles: number,
        readonly importedProjects: number,
        readonly importedFolders: number,
        readonly compensationFailed: boolean,
    ) {
        super(message);
        this.name = "CanvasArchiveImportError";
    }
}

export async function importCanvasArchive(zip: Map<string, Blob>, targetFolderId: string | null) {
    const parsed = await parseCanvasArchive(zip);
    const remap = createCanvasArchiveRemap(parsed.manifest);
    const archive = remapCanvasArchive(parsed.manifest, remap);
    const projectStore = useCanvasStore.getState();
    const folderStore = useCanvasFolderStore.getState();
    const previousProjects = projectStore.projects;
    const previousFolders = folderStore.folders;
    const importedFolders = (archive.folders || []).map((folder) =>
        normalizeCanvasFolder({
            ...folder,
            parentId: folder.parentId || targetFolderId,
        }),
    );
    const importedProjects = archive.projects.map((item) =>
        normalizeCanvasProject({
            ...item.project,
            folderId: item.project.folderId || targetFolderId,
        }),
    );
    const writtenImageKeys: string[] = [];
    const writtenMediaKeys: string[] = [];
    let storesCommitted = false;

    try {
        for (const item of archive.projects) {
            const sourceItem = parsed.manifest.projects.find((candidate) => remap.projectIds.get(candidate.project.id) === item.project.id);
            for (const asset of item.files) {
                const oldKey = [...remap.storageKeys].find(([, nextKey]) => nextKey === asset.storageKey)?.[0] || asset.storageKey;
                const sourceAsset = sourceItem?.files.find((candidate) => candidate.storageKey === oldKey);
                const blob = sourceAsset ? parsed.files.get(sourceAsset.path) : undefined;
                if (!blob) throw new Error(`Canvas archive is missing staged asset: ${asset.storageKey}`);
                const typedBlob = blob.type ? blob : blob.slice(0, blob.size, asset.mimeType);
                if (isImageStorageKey(asset.storageKey)) {
                    await setImageBlob(asset.storageKey, typedBlob);
                    writtenImageKeys.push(asset.storageKey);
                } else {
                    await setMediaBlob(asset.storageKey, typedBlob);
                    writtenMediaKeys.push(asset.storageKey);
                }
            }
        }

        folderStore.replaceFolders([...previousFolders, ...importedFolders]);
        projectStore.replaceProjects([...importedProjects, ...previousProjects]);
        storesCommitted = true;
        await Promise.all([useCanvasFolderStore.getState().flush(), useCanvasStore.getState().flush()]);
        return { projects: importedProjects.length, folders: importedFolders.length, files: writtenImageKeys.length + writtenMediaKeys.length };
    } catch (error) {
        let compensationFailed = false;
        try {
            if (storesCommitted) {
                useCanvasFolderStore.getState().replaceFolders(previousFolders);
                useCanvasStore.getState().replaceProjects(previousProjects);
                await Promise.all([useCanvasFolderStore.getState().flush(), useCanvasStore.getState().flush()]);
            }
            await Promise.all([deleteStoredImages(writtenImageKeys), deleteStoredMedia(writtenMediaKeys)]);
        } catch {
            compensationFailed = true;
        }
        throw new CanvasArchiveImportError(
            error instanceof Error ? error.message : "Canvas archive import failed",
            writtenImageKeys.length + writtenMediaKeys.length,
            storesCommitted ? importedProjects.length : 0,
            storesCommitted ? importedFolders.length : 0,
            compensationFailed,
        );
    }
}

function isImageStorageKey(storageKey: string) {
    return storageKey.startsWith("image:") || storageKey.startsWith("canvas-cover:");
}
