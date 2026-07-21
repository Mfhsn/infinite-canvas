import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type StoreHydrationStatus = "idle" | "loading" | "success" | "error";
export type StoreWriteStatus = "idle" | "pending" | "success" | "error";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    folderId: string | null;
    isDefault: boolean;
    coverStorageKey?: string;
    coverUpdatedAt?: string;
};

export type CanvasFolder = {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
};

export type LibraryStoreLifecycle = {
    hydrated: boolean;
    hydrationStatus: StoreHydrationStatus;
    writeStatus: StoreWriteStatus;
    generation: number;
    lastError?: string;
    flush: () => Promise<void>;
    retryHydration: () => Promise<void>;
    retryWrite: () => Promise<void>;
};
