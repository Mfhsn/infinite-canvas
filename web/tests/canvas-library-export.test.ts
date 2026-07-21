import { describe, expect, spyOn, test } from "bun:test";

import * as fileStorage from "@/services/file-storage";
import * as imageStorage from "@/services/image-storage";
import { collectCanvasProjectStorageKeys, collectExportFolderAncestors, createCanvasArchiveRemap, parseCanvasArchive, remapCanvasArchive } from "@/lib/canvas/canvas-archive";
import { createCanvasProjectsArchive } from "@/lib/canvas/canvas-export";
import { createZip, readZip } from "@/lib/zip";
import type { CanvasArchiveFolder, CanvasArchiveProject, CanvasExportFileV3, CanvasExportFileV4 } from "@/types/canvas-export";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";

describe("canvas archive protocol", () => {
    test("reads a valid v3 archive", async () => {
        const manifest: CanvasExportFileV3 = {
            app: "infinite-canvas",
            version: 3,
            exportedAt: "2026-01-01T00:00:00.000Z",
            projects: [{ project: project("old-project"), files: [{ storageKey: "image:old", path: "projects/old/files/asset.png", mimeType: "image/png", bytes: 3 }] }],
        };
        const parsed = await parseCanvasArchive(
            await readZip(
                await createZip([
                    { name: "projects.json", data: JSON.stringify(manifest) },
                    { name: "projects/old/files/asset.png", data: new Uint8Array([1, 2, 3]) },
                ]),
            ),
        );

        expect(parsed.manifest.version).toBe(3);
        expect(parsed.manifest.projects[0]?.project.id).toBe("old-project");
    });

    test("writes v4, includes active folder ancestors, and explicitly collects the cover", async () => {
        const cover = new Blob([new Uint8Array([9, 8])], { type: "image/png" });
        const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
        spyOn(imageStorage, "getImageBlob").mockImplementation(async (key) => (key === "canvas-cover:project:rev" ? cover : key === "image:node" ? image : null));
        spyOn(fileStorage, "getMediaBlob").mockResolvedValue(null);
        const folders: CanvasArchiveFolder[] = [folder("root-folder", null), folder("child-folder", "root-folder"), { ...folder("deleted-folder", null), deletedAt: "2026-01-02T00:00:00.000Z" }, folder("unrelated-folder", null)];
        const source = {
            ...project("project"),
            folderId: "child-folder",
            coverStorageKey: "canvas-cover:project:rev",
            nodes: [{ metadata: { storageKey: "image:node" } }],
        } as unknown as CanvasArchiveProject;

        const archive = await createCanvasProjectsArchive([source], folders);
        const parsed = await parseCanvasArchive(await readZip(archive));

        expect(parsed.manifest.version).toBe(4);
        if (parsed.manifest.version !== 4) throw new Error("expected v4");
        expect(parsed.manifest.folders?.map((item) => item.id)).toEqual(["root-folder", "child-folder"]);
        expect(parsed.manifest.projects[0]?.files.map((item) => item.storageKey).sort()).toEqual(["canvas-cover:project:rev", "image:node"]);
    });

    test("accepts v4 without folders and remaps project, folder, cover, and nested storage keys", async () => {
        const manifest: CanvasExportFileV4 = {
            app: "infinite-canvas",
            version: 4,
            exportedAt: "2026-01-01T00:00:00.000Z",
            folders: [folder("folder-old", null)],
            projects: [
                {
                    project: {
                        ...project("project-old"),
                        folderId: "folder-old",
                        coverStorageKey: "canvas-cover:project-old:rev",
                        nodes: [{ metadata: { storageKey: "image:old" } }],
                    } as unknown as CanvasArchiveProject,
                    files: [
                        { storageKey: "canvas-cover:project-old:rev", path: "cover.png", mimeType: "image/png", bytes: 1 },
                        { storageKey: "image:old", path: "image.png", mimeType: "image/png", bytes: 1 },
                    ],
                },
            ],
        };
        const manifestWithoutFolders = {
            ...manifest,
            folders: undefined,
            projects: manifest.projects.map((item) => ({ ...item, project: { ...item.project, folderId: null } })),
        };
        const parsedWithoutFolders = await parseCanvasArchive(
            new Map([
                ["projects.json", new Blob([JSON.stringify(manifestWithoutFolders)])],
                ["cover.png", new Blob(["x"])],
                ["image.png", new Blob(["y"])],
            ]),
        );
        expect(parsedWithoutFolders.manifest.version).toBe(4);

        const remap = createCanvasArchiveRemap(manifest, {
            projectId: () => "project-new",
            folderId: () => "folder-new",
            storageKey: (key) => `remapped:${key}`,
        });
        const remapped = remapCanvasArchive(manifest, remap);

        expect(remapped.folders?.[0]?.id).toBe("folder-new");
        expect(remapped.projects[0]?.project).toMatchObject({
            id: "project-new",
            folderId: "folder-new",
            coverStorageKey: "remapped:canvas-cover:project-old:rev",
            nodes: [{ metadata: { storageKey: "remapped:image:old" } }],
        });
        expect(remapped.projects[0]?.files.map((item) => item.storageKey)).toEqual(["remapped:canvas-cover:project-old:rev", "remapped:image:old"]);
    });

    test("collects cover keys even when they are not nested storageKey properties", () => {
        const source = { ...project("project"), coverStorageKey: "canvas-cover:project:rev" };
        expect(collectCanvasProjectStorageKeys(source)).toContain("canvas-cover:project:rev");
    });

    test("extracts only active referenced folders and ancestors", () => {
        const folders = [folder("root", null), folder("child", "root"), { ...folder("deleted", "root"), deletedAt: "now" }, folder("other", null)];
        expect(
            collectExportFolderAncestors(
                [
                    { ...project("one"), folderId: "child" },
                    { ...project("two"), folderId: "deleted" },
                ],
                folders,
            ).map((item) => item.id),
        ).toEqual(["root", "child"]);
    });

    test("rejects malformed manifests, duplicate ids, missing files, and conflicting cover keys", async () => {
        await expect(parseCanvasArchive(new Map([["projects.json", new Blob([JSON.stringify({ app: "infinite-canvas", version: 5, exportedAt: "now", projects: [] })])]]))).rejects.toThrow("Unsupported canvas archive version");

        const duplicateProject = {
            app: "infinite-canvas",
            version: 4,
            exportedAt: "now",
            projects: [
                { project: project("same"), files: [] },
                { project: project("same"), files: [] },
            ],
        };
        await expect(parseCanvasArchive(new Map([["projects.json", new Blob([JSON.stringify(duplicateProject)])]]))).rejects.toThrow("duplicate project id");

        const missing = { app: "infinite-canvas", version: 3, exportedAt: "now", projects: [{ project: project("one"), files: [{ storageKey: "image:x", path: "missing.png", mimeType: "image/png", bytes: 1 }] }] };
        await expect(parseCanvasArchive(new Map([["projects.json", new Blob([JSON.stringify(missing)])]]))).rejects.toThrow("missing asset");

        const sharedCover = {
            app: "infinite-canvas",
            version: 4,
            exportedAt: "now",
            projects: ["one", "two"].map((id) => ({ project: { ...project(id), coverStorageKey: "canvas-cover:shared:rev" }, files: [{ storageKey: "canvas-cover:shared:rev", path: `${id}.png`, mimeType: "image/png", bytes: 1 }] })),
        };
        await expect(
            parseCanvasArchive(
                new Map([
                    ["projects.json", new Blob([JSON.stringify(sharedCover)])],
                    ["one.png", new Blob(["1"])],
                    ["two.png", new Blob(["2"])],
                ]),
            ),
        ).rejects.toThrow("cover key is shared");
    });
});

function project(id: string): CanvasArchiveProject {
    return {
        id,
        title: id,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

function folder(id: string, parentId: string | null): CanvasArchiveFolder {
    return { id, name: id, parentId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
