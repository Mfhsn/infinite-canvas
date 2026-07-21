import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist, type StorageValue } from "zustand/middleware";

import { normalizeCanvasProject } from "@/lib/canvas/canvas-library";
import { createDataStateStorage, createGenerationAwarePersistStorage, type GenerationAwarePersistStorage } from "@/lib/localforage-storage";
import type { CanvasProject, LibraryStoreLifecycle, StoreWriteStatus } from "@/types/canvas-library";

export type { CanvasProject } from "@/types/canvas-library";

type CanvasStore = LibraryStoreLifecycle & {
    projects: CanvasProject[];
    createProject: (title?: string, folderId?: string | null) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport" | "folderId" | "isDefault" | "coverStorageKey" | "coverUpdatedAt">>) => void;
};

const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
const dataStateStorage = createDataStateStorage("canvas");

function writeErrorMessage(error?: Error) {
    return error?.message || "Canvas projects could not be saved";
}

let getCanvasGeneration = () => 0;
let updateCanvasWriteState: (writeStatus: StoreWriteStatus, error?: Error) => void = () => undefined;

const canvasStorage: GenerationAwarePersistStorage<CanvasStore> = createGenerationAwarePersistStorage<CanvasStore>(dataStateStorage, {
    getGeneration: () => getCanvasGeneration(),
    initialValue: { state: { projects: [] } as unknown as StorageValue<CanvasStore>["state"], version: 0 },
    normalizeValue: (value) => ({
        ...value,
        state: {
            ...value.state,
            projects: Array.isArray((value.state as Partial<CanvasStore>).projects) ? (value.state as Partial<CanvasStore>).projects!.map(normalizeCanvasProject) : [],
        },
    }),
    onWriteState: (writeStatus, error) => updateCanvasWriteState(writeStatus, error),
});

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            hydrationStatus: "loading",
            writeStatus: "idle",
            generation: 0,
            lastError: undefined,
            projects: [],
            createProject: (title = "", folderId = null) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project = normalizeCanvasProject({
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: { x: 0, y: 0, k: 1 },
                    folderId,
                    isDefault: false,
                });
                set((state) => ({ projects: [project, ...state.projects], generation: state.generation + 1 }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project = normalizeCanvasProject({ ...source, id: nanoid(), updatedAt: now, createdAt: source.createdAt || now });
                set((state) => ({ projects: [project, ...state.projects], generation: state.generation + 1 }));
                return project.id;
            },
            openProject: (id) => get().projects.find((item) => item.id === id) || null,
            renameProject: (id, title) =>
                set((state) => {
                    const current = state.projects.find((project) => project.id === id);
                    if (!current) return state;
                    const nextTitle = title.trim() || current.title;
                    if (nextTitle === current.title) return state;
                    return {
                        projects: state.projects.map((project) => (project.id === id ? { ...project, title: nextTitle, updatedAt: new Date().toISOString() } : project)),
                        generation: state.generation + 1,
                    };
                }),
            deleteProjects: (ids) =>
                set((state) => {
                    const deleted = new Set(ids);
                    const projects = state.projects.filter((project) => !deleted.has(project.id));
                    return projects.length === state.projects.length ? state : { projects, generation: state.generation + 1 };
                }),
            replaceProjects: (projects) => set((state) => ({ projects: projects.map(normalizeCanvasProject), generation: state.generation + 1 })),
            updateProject: (id, patch) =>
                set((state) => {
                    if (!state.projects.some((project) => project.id === id)) return state;
                    return {
                        projects: state.projects.map((project) => (project.id === id ? normalizeCanvasProject({ ...project, ...patch, updatedAt: new Date().toISOString() }) : project)),
                        generation: state.generation + 1,
                    };
                }),
            flush: () => canvasStorage.flush(),
            retryHydration: async () => {
                useCanvasStore.setState({ hydrated: false, hydrationStatus: "loading", lastError: undefined });
                await useCanvasStore.persist.rehydrate();
                const state = useCanvasStore.getState();
                if (state.hydrationStatus === "error") throw new Error(state.lastError || "Canvas projects could not be loaded");
            },
            retryWrite: () => canvasStorage.retryWrite(),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage.persist,
            partialize: (state) => ({ projects: state.projects }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                useCanvasStore.setState({
                    hydrated: !error,
                    hydrationStatus: error ? "error" : "success",
                    lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
                });
            },
        },
    ),
);

getCanvasGeneration = () => useCanvasStore.getState().generation;
updateCanvasWriteState = (writeStatus, error) => {
    useCanvasStore.setState((state) => ({
        writeStatus,
        lastError: writeStatus === "error" ? writeErrorMessage(error) : writeStatus === "success" && state.hydrationStatus !== "error" ? undefined : state.lastError,
    }));
};
