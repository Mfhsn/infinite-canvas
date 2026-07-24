import { describe, expect, test } from "bun:test";

import { appRouterBasename, joinAppBasePath, normalizeAppBasePath } from "@/lib/app-base-path-normalize";

describe("application base path", () => {
    test("normalizes root and nested deployment paths", () => {
        expect(normalizeAppBasePath(undefined)).toBe("/");
        expect(normalizeAppBasePath("/")).toBe("/");
        expect(normalizeAppBasePath(" /infinite-canvas ")).toBe("/infinite-canvas/");
        expect(normalizeAppBasePath("/apps/infinite-canvas/")).toBe("/apps/infinite-canvas/");
    });

    test("rejects origins, query strings, and traversal segments", () => {
        expect(() => normalizeAppBasePath("https://example.com/canvas")).toThrow("absolute URL path");
        expect(() => normalizeAppBasePath("/canvas?debug=1")).toThrow("absolute URL path");
        expect(() => normalizeAppBasePath("/../canvas")).toThrow("relative path segments");
    });

    test("builds router and full-page handoff paths under the configured prefix", () => {
        expect(appRouterBasename("/")).toBe("/");
        expect(appRouterBasename("/infinite-canvas/")).toBe("/infinite-canvas");
        expect(joinAppBasePath("canvas", "/infinite-canvas/")).toBe("/infinite-canvas/canvas");
        expect(joinAppBasePath("/canvas?mode=new", "/infinite-canvas/")).toBe("/infinite-canvas/canvas?mode=new");
        expect(joinAppBasePath("logo.svg", "/")).toBe("/logo.svg");
    });
});
