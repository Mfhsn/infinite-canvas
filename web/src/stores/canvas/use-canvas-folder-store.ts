import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";

import { compareCanvasFolders, mergeCanvasFolders, normalizeCanvasFolder, wouldCreateFolderCycle } from "@/lib/canvas/canvas-library";
import { createDataStateStorage, createGenerationAwarePersistStorage, type GenerationAwarePersistStorage } from "@/lib/localforage-storage";
import type { CanvasFolder, LibraryStoreLifecycle, StoreWriteStatus } from "@/types/canvas-library";

type CanvasFolderStore = LibraryStoreLifecycle & {
    folders: CanvasFolder[];
    createFolder: (name?: string, parentId?: string | null) => string;
    renameFolder: (id: string, name: string) => void;
    moveFolder: (id: string, parentId: string | null) => void;
    deleteFolder: (id: string, deletedAt?: string) => void;
    replaceFolders: (folders: CanvasFolder[]) => void;
    mergeFolders: (folders: CanvasFolder[]) => void;
};

const CANVAS_FOLDER_STORE_KEY = "infinite-canvas:canvas_folder_store";
const dataStateStorage = createDataStateStorage("canvas_folders");

let getFolderGeneration = () => 0;
let updateFolderWriteState: (writeStatus: StoreWriteStatus, error?: Error) => void = () => undefined;

const folderStorage: GenerationAwarePersistStorage<CanvasFolderStore> = createGenerationAwarePersistStorage<CanvasFolderStore>(dataStateStorage, {
    getGeneration: () => getFolderGeneration(),
    initialValue: { state: { folders: [] } as unknown as StorageValue<CanvasFolderStore>["state"], version: 0 },
    normalizeValue: (value) => ({
        ...value,
        state: {
            ...value.state,
            folders: Array.isArray((value.state as Partial<CanvasFolderStore>).folders) ? (value.state as Partial<CanvasFolderStore>).folders!.map(normalizeCanvasFolder).sort(compareCanvasFolders) : [],
        },
    }),
    onWriteState: (writeStatus, error) => updateFolderWriteState(writeStatus, error),
});

export const useCanvasFolderStore = create<CanvasFolderStore>()(
    persist(
        (set) => ({
            hydrated: false,
            hydrationStatus: "loading",
            writeStatus: "idle",
            generation: 0,
            lastError: undefined,
            folders: [],
            createFolder: (name = "", parentId = null) => {
                const state = useCanvasFolderStore.getState();
                if (parentId && !state.folders.some((folder) => folder.id === parentId && !folder.deletedAt)) throw new Error("Parent folder is not active");
                const now = new Date().toISOString();
                const id = nanoid();
                const folder = normalizeCanvasFolder({ id, name, parentId, createdAt: now, updatedAt: now });
                set((current) => ({ folders: [...current.folders, folder].sort(compareCanvasFolders), generation: current.generation + 1 }));
                return id;
            },
            renameFolder: (id, name) =>
                set((state) => {
                    const current = state.folders.find((folder) => folder.id === id);
                    const nextName = name.trim();
                    if (!current || current.deletedAt || !nextName || nextName === current.name) return state;
                    return {
                        folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name: nextName, updatedAt: new Date().toISOString() } : folder)).sort(compareCanvasFolders),
                        generation: state.generation + 1,
                    };
                }),
            moveFolder: (id, parentId) =>
                set((state) => {
                    const current = state.folders.find((folder) => folder.id === id);
                    if (!current || current.deletedAt) return state;
                    if (parentId && !state.folders.some((folder) => folder.id === parentId && !folder.deletedAt)) throw new Error("Parent folder is not active");
                    if (wouldCreateFolderCycle(state.folders, id, parentId)) throw new Error("Moving this folder would create a cycle");
                    if (current.parentId === parentId) return state;
                    return {
                        folders: state.folders.map((folder) => (folder.id === id ? { ...folder, parentId, updatedAt: new Date().toISOString() } : folder)),
                        generation: state.generation + 1,
                    };
                }),
            deleteFolder: (id, deletedAt = new Date().toISOString()) =>
                set((state) => {
                    const current = state.folders.find((folder) => folder.id === id);
                    if (!current || (current.deletedAt && current.deletedAt >= deletedAt)) return state;
                    return {
                        folders: state.folders.map((folder) => (folder.id === id ? { ...folder, deletedAt, updatedAt: deletedAt } : folder)),
                        generation: state.generation + 1,
                    };
                }),
            replaceFolders: (folders) => set((state) => ({ folders: folders.map(normalizeCanvasFolder).sort(compareCanvasFolders), generation: state.generation + 1 })),
            mergeFolders: (folders) => set((state) => ({ folders: mergeCanvasFolders(state.folders, folders), generation: state.generation + 1 })),
            flush: () => folderStorage.flush(),
            retryHydration: async () => {
                useCanvasFolderStore.setState({ hydrated: false, hydrationStatus: "loading", lastError: undefined });
                await useCanvasFolderStore.persist.rehydrate();
                const state = useCanvasFolderStore.getState();
                if (state.hydrationStatus === "error") throw new Error(state.lastError || "Canvas folders could not be loaded");
            },
            retryWrite: () => folderStorage.retryWrite(),
        }),
        {
            name: CANVAS_FOLDER_STORE_KEY,
            storage: folderStorage.persist,
            partialize: (state) => ({ folders: state.folders }) as StorageValue<CanvasFolderStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                useCanvasFolderStore.setState({
                    hydrated: !error,
                    hydrationStatus: error ? "error" : "success",
                    lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
                });
            },
        },
    ),
);

getFolderGeneration = () => useCanvasFolderStore.getState().generation;
updateFolderWriteState = (writeStatus, error) => {
    useCanvasFolderStore.setState((state) => ({
        writeStatus,
        lastError: writeStatus === "error" ? error?.message || "Canvas folders could not be saved" : writeStatus === "success" && state.hydrationStatus !== "error" ? undefined : state.lastError,
    }));
};
