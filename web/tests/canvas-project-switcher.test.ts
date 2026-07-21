import { describe, expect, test } from "bun:test";

import { normalizeCanvasFolder, normalizeCanvasProject } from "@/lib/canvas/canvas-library";
import { getCanvasProjectSwitcherView } from "@/lib/canvas/canvas-project-switcher";

const folder = (id: string, name: string, parentId: string | null = null, deletedAt?: string) => normalizeCanvasFolder({ id, name, parentId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt });

const project = (id: string, title: string, folderId: string | null, updatedAt = "2026-01-01T00:00:00.000Z") => normalizeCanvasProject({ id, title, folderId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt, nodes: [], connections: [] });

describe("canvas project switcher", () => {
    test("shows only direct child folders and projects", () => {
        const folders = [folder("root-child", "Root child"), folder("selected", "Selected"), folder("nested", "Nested", "selected")];
        const projects = [project("root-project", "Root", null), project("direct", "Direct", "selected"), project("nested-project", "Nested", "nested")];

        const view = getCanvasProjectSwitcherView("selected", projects, folders);

        expect(view.currentFolder?.id).toBe("selected");
        expect(view.folders.map((item) => item.id)).toEqual(["nested"]);
        expect(view.projects.map((item) => item.id)).toEqual(["direct"]);
    });

    test("builds breadcrumbs from the root ancestor to the selected folder", () => {
        const folders = [folder("a", "A"), folder("b", "B", "a"), folder("c", "C", "b")];

        expect(getCanvasProjectSwitcherView("c", [], folders).breadcrumbs.map((item) => item.id)).toEqual(["a", "b", "c"]);
    });

    test("lifts descendants and projects from deleted folders to the nearest active ancestor", () => {
        const folders = [folder("active", "Active"), folder("deleted", "Deleted", "active", "2026-01-02T00:00:00.000Z"), folder("child", "Child", "deleted")];
        const projects = [project("lifted", "Lifted", "deleted"), project("nested", "Nested", "child")];

        const view = getCanvasProjectSwitcherView("active", projects, folders);

        expect(view.folders.map((item) => item.id)).toEqual(["child"]);
        expect(view.projects.map((item) => item.id)).toEqual(["lifted"]);
    });

    test("sorts folders by name and projects by latest update with deterministic ties", () => {
        const folders = [folder("z", "Beta"), folder("b", "Alpha"), folder("a", "Alpha")];
        const projects = [
            project("old", "Old", null, "2026-01-01T00:00:00.000Z"),
            project("z", "Same", null, "2026-01-03T00:00:00.000Z"),
            project("a", "Same", null, "2026-01-03T00:00:00.000Z"),
            project("title", "Alpha", null, "2026-01-03T00:00:00.000Z"),
        ];

        const view = getCanvasProjectSwitcherView(null, projects, folders);

        expect(view.folders.map((item) => item.id)).toEqual(["a", "b", "z"]);
        expect(view.projects.map((item) => item.id)).toEqual(["title", "a", "z", "old"]);
    });
});
