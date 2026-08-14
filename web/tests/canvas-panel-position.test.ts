import { describe, expect, test } from "bun:test";

import { getVerticalViewportCorrection } from "@/lib/canvas/canvas-panel-position";

describe("canvas node editor panel position", () => {
    const container = { top: 100, bottom: 900 };

    test("keeps a fully visible panel in place", () => {
        expect(getVerticalViewportCorrection({ top: 300, bottom: 700 }, container)).toBe(0);
    });

    test("moves a panel upward when its bottom is outside the canvas", () => {
        expect(getVerticalViewportCorrection({ top: 650, bottom: 950 }, container)).toBe(-62);
    });

    test("moves an oversized panel to the top canvas boundary", () => {
        expect(getVerticalViewportCorrection({ top: 250, bottom: 1100 }, container)).toBe(-138);
    });
});
