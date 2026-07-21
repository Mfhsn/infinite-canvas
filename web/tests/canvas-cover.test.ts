import { describe, expect, test } from "bun:test";

import { CANVAS_COVER_HEIGHT, CANVAS_COVER_WEBP_QUALITY, CANVAS_COVER_WIDTH, createCanvasCoverBlob, createCanvasCoverKey, selectCanvasCoverCandidate } from "@/lib/canvas/canvas-cover";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeStatus } from "@/types/canvas";

function node(id: string, type: CanvasNodeType, status: CanvasNodeStatus, content?: string, extra: Record<string, unknown> = {}): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { status, content, ...extra },
    };
}

describe("canvas cover lifecycle", () => {
    test("creates versioned project cover keys", () => {
        expect(createCanvasCoverKey("project-1", "revision-2")).toBe("canvas-cover:project-1:revision-2");
        expect(() => createCanvasCoverKey("", "revision-2")).toThrow();
    });

    test("prefers the latest successful image, then a successful video poster", () => {
        const nodes = [
            node("image-old", CanvasNodeType.Image, "success", "old.png"),
            node("image-loading", CanvasNodeType.Image, "loading", "loading.png"),
            node("video-new", CanvasNodeType.Video, "success", "video.mp4", { posterUrl: "poster.png" }),
            node("image-new", CanvasNodeType.Image, "success", "new.png"),
            node("image-error", CanvasNodeType.Image, "error", "error.png"),
        ];
        expect(selectCanvasCoverCandidate(nodes)).toEqual({ id: "image-new", kind: "image", source: "new.png" });
        expect(selectCanvasCoverCandidate(nodes.filter((item) => item.type !== CanvasNodeType.Image))).toEqual({ id: "video-new", kind: "video", source: "video.mp4", poster: "poster.png" });
        expect(selectCanvasCoverCandidate([node("video-loading", CanvasNodeType.Video, "loading", "video.mp4")])).toBeNull();
    });

    test("encodes 640x360 WebP at quality .82", async () => {
        const calls: Array<[string, number | undefined]> = [];
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => undefined }),
            toBlob: (callback: BlobCallback, type: string, quality?: number) => {
                calls.push([type, quality]);
                callback(new Blob(["webp"], { type: "image/webp" }));
            },
        } as unknown as HTMLCanvasElement;
        const blob = await createCanvasCoverBlob(
            { id: "image", kind: "image", source: "image.png" },
            {
                createCanvas: () => canvas,
                loadImage: async () => ({ source: {} as CanvasImageSource, width: 800, height: 600 }),
            },
        );
        expect(canvas.width).toBe(CANVAS_COVER_WIDTH);
        expect(canvas.height).toBe(CANVAS_COVER_HEIGHT);
        expect(blob.type).toBe("image/webp");
        expect(calls).toEqual([["image/webp", CANVAS_COVER_WEBP_QUALITY]]);
    });

    test("falls back to PNG when WebP encoding returns no usable blob", async () => {
        const calls: string[] = [];
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => undefined }),
            toBlob: (callback: BlobCallback, type: string) => {
                calls.push(type);
                callback(type === "image/webp" ? null : new Blob(["png"], { type: "image/png" }));
            },
        } as unknown as HTMLCanvasElement;
        const blob = await createCanvasCoverBlob(
            { id: "video", kind: "video", source: "video.mp4" },
            {
                createCanvas: () => canvas,
                loadVideoFrame: async () => ({ source: {} as CanvasImageSource, width: 1920, height: 1080 }),
            },
        );
        expect(blob.type).toBe("image/png");
        expect(calls).toEqual(["image/webp", "image/png"]);
    });
});
