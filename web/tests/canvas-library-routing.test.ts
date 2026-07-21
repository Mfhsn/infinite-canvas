import { describe, expect, test } from "bun:test";

import { buildCanvasLibrarySearch, buildCanvasProjectUrl, buildProjectHandoffSearch, parseCanvasLibraryRoute } from "@/lib/canvas/canvas-library-route";

describe("canvas library routing", () => {
    test("parses only supported library state", () => {
        expect(parseCanvasLibraryRoute("folder=folder-1&q=%20Ideas%20&type=folder&extra=ignored")).toEqual({ folder: "folder-1", q: "Ideas", type: "folder" });
        expect(parseCanvasLibraryRoute("type=video")).toEqual({ folder: null, q: "", type: "all" });
    });

    test("serializes canonical library query parameters", () => {
        expect(buildCanvasLibrarySearch({ folder: " nested ", q: " cats ", type: "canvas" }).toString()).toBe("folder=nested&q=cats&type=canvas");
        expect(buildCanvasLibrarySearch({ folder: null, q: "", type: "all" }).toString()).toBe("");
    });

    test("keeps project handoff only for a legal mode", () => {
        expect(buildProjectHandoffSearch("mode=choose&agentUrl=https%3A%2F%2Fexample.test&agentToken=secret&folder=f&q=ignored&type=folder&unknown=x").toString()).toBe("mode=choose&agentUrl=https%3A%2F%2Fexample.test&agentToken=secret");
        expect(buildProjectHandoffSearch("mode=invalid&agentUrl=https%3A%2F%2Fexample.test&agentToken=secret").toString()).toBe("");
        expect(buildProjectHandoffSearch("agentUrl=https%3A%2F%2Fexample.test&agentToken=secret").toString()).toBe("");
    });

    test("never carries library state into a project URL", () => {
        expect(buildCanvasProjectUrl("project/a", "mode=recent&folder=f&q=cat&type=canvas&agentToken=t")).toBe("/canvas/project%2Fa?mode=recent&agentToken=t");
    });
});
