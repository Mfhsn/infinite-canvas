import { describe, expect, test } from "bun:test";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";
const { resolveHomeSecondaryAction } = await import("@/pages/home");

describe("home workbench visibility", () => {
    test("hides quick image when the image workbench is disabled", () => {
        expect(resolveHomeSecondaryAction(undefined, false)).toBeNull();
    });

    test("keeps canvas continuation independent from workbench visibility", () => {
        expect(resolveHomeSecondaryAction("canvas-1", false)).toEqual({
            kind: "canvas",
            path: "/canvas/canvas-1",
            labelKey: "home.continueCreating",
        });
    });

    test("shows quick image only when the image workbench is enabled and there is no canvas", () => {
        expect(resolveHomeSecondaryAction(undefined, true)).toEqual({
            kind: "image",
            path: "/image",
            labelKey: "home.quickImage",
        });
    });
});
