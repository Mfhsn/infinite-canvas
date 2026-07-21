import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { importCanvasArchive } from "@/lib/canvas/canvas-import";
import * as fileStorage from "@/services/file-storage";
import * as imageStorage from "@/services/image-storage";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

describe("canvas archive import", () => {
    afterEach(() => {
        useCanvasStore.getState().replaceProjects([]);
        useCanvasFolderStore.getState().replaceFolders([]);
    });

    test("remaps folders, projects, covers and assets before committing", async () => {
        const imageWrites: string[] = [];
        spyOn(imageStorage, "setImageBlob").mockImplementation(async (key) => {
            imageWrites.push(key);
            return key;
        });
        spyOn(fileStorage, "setMediaBlob").mockResolvedValue("");

        const manifest = {
            app: "infinite-canvas",
            version: 4,
            exportedAt: "2026-01-01T00:00:00.000Z",
            folders: [{ id: "old-folder", name: "Imported", parentId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
            projects: [
                {
                    project: {
                        id: "old-project",
                        title: "Imported",
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                        nodes: [],
                        connections: [],
                        chatSessions: [],
                        activeChatId: null,
                        backgroundMode: "lines",
                        showImageInfo: false,
                        viewport: { x: 0, y: 0, k: 1 },
                        folderId: "old-folder",
                        coverStorageKey: "canvas-cover:old-project:rev",
                    },
                    files: [{ storageKey: "canvas-cover:old-project:rev", path: "cover.webp", mimeType: "image/webp", bytes: 1 }],
                },
            ],
        };
        const result = await importCanvasArchive(
            new Map([
                ["projects.json", new Blob([JSON.stringify(manifest)])],
                ["cover.webp", new Blob(["x"], { type: "image/webp" })],
            ]),
            null,
        );

        const folder = useCanvasFolderStore.getState().folders[0];
        const project = useCanvasStore.getState().projects[0];
        expect(result).toEqual({ projects: 1, folders: 1, files: 1 });
        expect(project?.id).not.toBe("old-project");
        expect(project?.folderId).toBe(folder?.id);
        expect(project?.coverStorageKey).toStartWith(`canvas-cover:${project?.id}:`);
        expect(imageWrites).toEqual([project?.coverStorageKey as string]);
    });
});
