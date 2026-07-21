import { describe, expect, test } from "bun:test";

import { findNearestActiveFolder, mergeCanvasFolders, normalizeCanvasFolder, normalizeCanvasProject, wouldCreateFolderCycle } from "@/lib/canvas/canvas-library";
import { applyFolderDeletionToFolders, applyFolderDeletionToProjects, getFolderDeletionImpact } from "@/lib/canvas/canvas-folder-actions";

describe("canvas library model", () => {
    test("normalizes legacy projects idempotently and rejects invalid cover keys", () => {
        const legacy = {
            id: "project-1",
            title: "Legacy",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            nodes: [],
            connections: [],
        };
        const normalized = normalizeCanvasProject({ ...legacy, coverStorageKey: "canvas-cover:other:1", coverUpdatedAt: 42 });
        expect(normalized.folderId).toBeNull();
        expect(normalized.isDefault).toBe(false);
        expect(normalized.coverStorageKey).toBeUndefined();
        expect(normalized.coverUpdatedAt).toBeUndefined();
        expect(normalizeCanvasProject(normalized)).toEqual(normalized);
    });

    test("normalizes folders without repairing parent references", () => {
        const folder = normalizeCanvasFolder({
            id: "child",
            name: " Child ",
            parentId: "missing-parent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        });
        expect(folder.parentId).toBe("missing-parent");
        expect(normalizeCanvasFolder(folder)).toEqual(folder);
    });

    test("uses remove-wins when folder versions are merged", () => {
        const active = normalizeCanvasFolder({ id: "folder", name: "Active", parentId: null, createdAt: "1", updatedAt: "9" });
        const deleted = normalizeCanvasFolder({ id: "folder", name: "Deleted", parentId: null, createdAt: "1", updatedAt: "4", deletedAt: "5" });
        expect(mergeCanvasFolders([active], [deleted])).toEqual([deleted]);
        expect(mergeCanvasFolders([deleted], [active])).toEqual([deleted]);
    });

    test("guards cycles and resolves the nearest active ancestor", () => {
        const folders = [
            normalizeCanvasFolder({ id: "a", name: "A", parentId: null, createdAt: "1", updatedAt: "1" }),
            normalizeCanvasFolder({ id: "b", name: "B", parentId: "a", createdAt: "1", updatedAt: "2", deletedAt: "3" }),
            normalizeCanvasFolder({ id: "c", name: "C", parentId: "b", createdAt: "1", updatedAt: "2" }),
        ];
        expect(wouldCreateFolderCycle(folders, "a", "c")).toBe(true);
        expect(findNearestActiveFolder("c", folders)).toEqual({ folderId: "c" });
        expect(findNearestActiveFolder("b", folders)).toEqual({ folderId: "a" });
        expect(findNearestActiveFolder("missing", folders)).toEqual({ folderId: null, diagnostic: "missing-folder" });
        const cycle = [normalizeCanvasFolder({ id: "x", name: "X", parentId: "y", createdAt: "1", updatedAt: "2", deletedAt: "3" }), normalizeCanvasFolder({ id: "y", name: "Y", parentId: "x", createdAt: "1", updatedAt: "2", deletedAt: "3" })];
        expect(findNearestActiveFolder("x", cycle)).toEqual({ folderId: null, diagnostic: "folder-cycle" });
    });

    test("computes deletion effects without mutating projects or folders", () => {
        const folders = [
            normalizeCanvasFolder({ id: "a", name: "A", parentId: null, createdAt: "1", updatedAt: "1" }),
            normalizeCanvasFolder({ id: "b", name: "B", parentId: "a", createdAt: "1", updatedAt: "2" }),
            normalizeCanvasFolder({ id: "c", name: "C", parentId: "b", createdAt: "1", updatedAt: "3" }),
        ];
        const projects = [
            normalizeCanvasProject({ id: "p-direct", title: "Direct", folderId: "b", createdAt: "1", updatedAt: "1", nodes: [], connections: [] }),
            normalizeCanvasProject({ id: "p-nested", title: "Nested", folderId: "c", createdAt: "1", updatedAt: "1", nodes: [], connections: [] }),
        ];
        const impact = getFolderDeletionImpact("b", folders, projects);
        expect(impact).toEqual({
            folderId: "b",
            promotedToFolderId: "a",
            directFolderIds: ["c"],
            directProjectIds: ["p-direct"],
            affectedFolderIds: ["c"],
            affectedProjectIds: ["p-direct", "p-nested"],
            totalResourceCount: 3,
        });
        expect(applyFolderDeletionToProjects(projects, impact).map((project) => [project.id, project.folderId])).toEqual([
            ["p-direct", "a"],
            ["p-nested", "c"],
        ]);
        expect(applyFolderDeletionToFolders(folders, impact).map((folder) => [folder.id, folder.parentId])).toEqual([
            ["a", null],
            ["b", "a"],
            ["c", "a"],
        ]);
        expect(folders[1].deletedAt).toBeUndefined();
        expect(projects[1].folderId).toBe("c");
    });
});
