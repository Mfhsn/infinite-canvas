import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasProjectLibraryFields = {
    folderId?: string | null;
    isDefault?: boolean;
    coverStorageKey?: string;
    coverUpdatedAt?: string;
};

export type CanvasArchiveProject = CanvasProject & CanvasProjectLibraryFields;

// Kept structural so this protocol can land before the folder store/model.
export type CanvasArchiveFolder = {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
};

type CanvasExportFileBase = {
    app: "infinite-canvas";
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasExportFileV3 = CanvasExportFileBase & {
    version: 3;
};

export type CanvasExportFileV4 = CanvasExportFileBase & {
    version: 4;
    folders?: CanvasArchiveFolder[];
};

export type CanvasExportFile = CanvasExportFileV3 | CanvasExportFileV4;

export type CanvasProjectExportItem = {
    project: CanvasArchiveProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
