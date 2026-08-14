import { describe, expect, test } from "bun:test";

import { defaultImageQuickToolIds, imageToolDefinitions, normalizeImageQuickToolIds, readImageQuickToolsConfig } from "@/components/canvas/canvas-image-toolbar-tools";

describe("canvas image toolbar tools", () => {
    test("hides reverse prompt from the toolbar, customization panel, and legacy saved selections", () => {
        expect(imageToolDefinitions.some((tool) => tool.id === "reversePrompt")).toBe(false);
        expect(defaultImageQuickToolIds).not.toContain("reversePrompt");
        expect(normalizeImageQuickToolIds(["download", "reversePrompt", "view"])).toEqual(["download", "view"]);
        expect(readImageQuickToolsConfig({ ids: ["reversePrompt", "copyPrompt"], showLabels: true })).toEqual({ ids: ["copyPrompt"], showLabels: true });
    });
});
