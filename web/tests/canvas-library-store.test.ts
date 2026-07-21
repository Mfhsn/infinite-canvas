import { describe, expect, test } from "bun:test";

import { createGenerationAwarePersistStorage } from "@/lib/localforage-storage";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { StateStorage } from "zustand/middleware";

describe("canvas library stores", () => {
    test("project and folder mutations advance generation", () => {
        const projectGeneration = useCanvasStore.getState().generation;
        const folderGeneration = useCanvasFolderStore.getState().generation;
        const projectId = useCanvasStore.getState().createProject("Project");
        const folderId = useCanvasFolderStore.getState().createFolder("Folder");
        expect(useCanvasStore.getState().generation).toBe(projectGeneration + 1);
        expect(useCanvasFolderStore.getState().generation).toBe(folderGeneration + 1);
        expect(useCanvasStore.getState().openProject(projectId)?.folderId).toBeNull();
        expect(useCanvasFolderStore.getState().folders.find((folder) => folder.id === folderId)?.deletedAt).toBeUndefined();
    });

    test("flush settles debounced writes and exposes success", async () => {
        useCanvasStore.getState().createProject("Flush project");
        expect(useCanvasStore.getState().writeStatus).toBe("pending");
        await useCanvasStore.getState().flush();
        expect(useCanvasStore.getState().writeStatus).toBe("success");
    });

    test("folder deletion leaves a tombstone and moving rejects cycles", () => {
        useCanvasFolderStore.getState().replaceFolders([]);
        const parentId = useCanvasFolderStore.getState().createFolder("Parent");
        const childId = useCanvasFolderStore.getState().createFolder("Child", parentId);
        expect(() => useCanvasFolderStore.getState().moveFolder(parentId, childId)).toThrow("cycle");
        useCanvasFolderStore.getState().deleteFolder(childId, "2026-01-01T00:00:00.000Z");
        expect(useCanvasFolderStore.getState().folders.find((folder) => folder.id === childId)?.deletedAt).toBe("2026-01-01T00:00:00.000Z");
        useCanvasFolderStore.getState().mergeFolders([{ ...useCanvasFolderStore.getState().folders.find((folder) => folder.id === childId)!, deletedAt: undefined, updatedAt: "2099-01-01T00:00:00.000Z" }]);
        expect(useCanvasFolderStore.getState().folders.find((folder) => folder.id === childId)?.deletedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    test("retry writes the newest generation instead of replaying a stale failed snapshot", async () => {
        const writes: string[] = [];
        let attempts = 0;
        let generation = 1;
        const statuses: string[] = [];
        const base: StateStorage = {
            getItem: async () => null,
            setItem: async (_name, value) => {
                attempts += 1;
                if (attempts === 1) throw new Error("offline");
                writes.push(value);
            },
            removeItem: async () => undefined,
        };
        const storage = createGenerationAwarePersistStorage<{ value: string }>(base, {
            debounceMs: 60_000,
            getGeneration: () => generation,
            onWriteState: (status) => statuses.push(status),
        });
        storage.persist.setItem("state", { state: { value: "old" }, version: 0 });
        expect(statuses.at(-1)).toBe("pending");
        await expect(storage.flush()).rejects.toThrow("offline");
        expect(statuses.at(-1)).toBe("error");
        generation = 2;
        storage.persist.setItem("state", { state: { value: "new" }, version: 0 });
        await storage.retryWrite();
        expect(writes).toEqual([JSON.stringify({ state: { value: "new" }, version: 0 })]);
        expect(statuses.at(-1)).toBe("success");
    });

    test("retry replays the failed snapshot when generation is unchanged", async () => {
        const writes: string[] = [];
        let attempts = 0;
        const base: StateStorage = {
            getItem: async () => null,
            setItem: async (_name, value) => {
                attempts += 1;
                if (attempts === 1) throw new Error("offline");
                writes.push(value);
            },
            removeItem: async () => undefined,
        };
        const storage = createGenerationAwarePersistStorage<{ value: string }>(base, { debounceMs: 60_000, getGeneration: () => 3 });
        const value = { state: { value: "same" }, version: 0 };
        storage.persist.setItem("state", value);
        await expect(storage.flush()).rejects.toThrow("offline");
        await storage.retryWrite();
        expect(writes).toEqual([JSON.stringify(value)]);
    });
});
