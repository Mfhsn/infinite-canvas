import { describe, expect, test } from "bun:test";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";

describe("canvas reference image upload", () => {
    test("creates an upstream image node consumed by image generation", async () => {
        const { buildReferenceImageInput } = await import("@/lib/canvas/canvas-reference-image");
        const { buildNodeGenerationContext } = await import("@/components/canvas/canvas-node-generation");
        const targetNode: CanvasNodeData = {
            id: "target-image",
            type: CanvasNodeType.Image,
            title: "Target",
            position: { x: 600, y: 300 },
            width: 340,
            height: 240,
            metadata: { content: "", status: "idle" },
        };
        const reference = buildReferenceImageInput({
            targetNode,
            image: {
                url: "blob:reference-image",
                storageKey: "image:reference",
                width: 1600,
                height: 900,
                bytes: 1024,
                mimeType: "image/png",
            },
            title: "reference.png",
            index: 0,
            nodeId: "reference-image",
            connectionId: "reference-connection",
        });

        expect(reference.connection).toEqual({ id: "reference-connection", fromNodeId: "reference-image", toNodeId: "target-image" });
        expect(reference.node).toMatchObject({
            id: "reference-image",
            type: CanvasNodeType.Image,
            title: "reference.png",
            metadata: {
                content: "blob:reference-image",
                storageKey: "image:reference",
                naturalWidth: 1600,
                naturalHeight: 900,
                mimeType: "image/png",
            },
        });

        const context = buildNodeGenerationContext(targetNode.id, [targetNode, reference.node], [reference.connection], "follow the reference");
        expect(context.referenceImages).toEqual([
            {
                id: "reference-image",
                name: "reference.png",
                type: "image/png",
                dataUrl: "blob:reference-image",
                storageKey: "image:reference",
            },
        ]);
    });

    test("orders explicitly selected canvas video frames and assigns their API roles", async () => {
        const { buildNodeGenerationContext } = await import("@/components/canvas/canvas-node-generation");
        const configNode: CanvasNodeData = {
            id: "video-config",
            type: CanvasNodeType.Config,
            title: "Video config",
            position: { x: 500, y: 300 },
            width: 420,
            height: 360,
            metadata: {
                generationMode: "video",
                composerContent: "animate the transition",
                videoMode: "start-end",
                videoFirstFrameNodeId: "frame-b",
                videoLastFrameNodeId: "frame-a",
            },
        };
        const frameA = imageNode("frame-a", "A", "blob:frame-a");
        const frameB = imageNode("frame-b", "B", "blob:frame-b");
        const context = buildNodeGenerationContext(
            configNode.id,
            [configNode, frameA, frameB],
            [
                { id: "a-config", fromNodeId: frameA.id, toNodeId: configNode.id },
                { id: "b-config", fromNodeId: frameB.id, toNodeId: configNode.id },
            ],
            configNode.metadata?.composerContent || "",
            { useStartEndFrames: true },
        );

        expect(context.referenceImages.map((image) => ({ id: image.id, role: image.videoRole }))).toEqual([
            { id: "frame-b", role: "first" },
            { id: "frame-a", role: "last" },
        ]);
        expect(context.referenceVideos).toEqual([]);
        expect(context.referenceAudios).toEqual([]);
    });

    test("applies frame slots when images connect directly to an empty video node", async () => {
        const { buildNodeGenerationContext, buildNodeGenerationInputs, isCanvasStartEndFrameSelectionComplete, resolveCanvasStartEndFrameInputs } = await import("@/components/canvas/canvas-node-generation");
        const videoNode: CanvasNodeData = {
            id: "empty-video",
            type: CanvasNodeType.Video,
            title: "Empty video",
            position: { x: 500, y: 300 },
            width: 420,
            height: 236,
            metadata: {
                content: "",
                status: "idle",
                videoMode: "start-end",
            },
        };
        const first = imageNode("direct-first", "Direct first", "blob:direct-first");
        const last = imageNode("direct-last", "Direct last", "blob:direct-last");
        const connections = [
            { id: "direct-first-video", fromNodeId: first.id, toNodeId: videoNode.id },
            { id: "direct-last-video", fromNodeId: last.id, toNodeId: videoNode.id },
        ];
        const inputs = buildNodeGenerationInputs(videoNode.id, [videoNode, first, last], connections);
        const selection = resolveCanvasStartEndFrameInputs(videoNode, inputs);

        expect(isCanvasStartEndFrameSelectionComplete(selection)).toBeTrue();
        expect(buildNodeGenerationContext(videoNode.id, [videoNode, first, last], connections, "animate", { useStartEndFrames: true }).referenceImages).toMatchObject([
            { id: "direct-first", videoRole: "first" },
            { id: "direct-last", videoRole: "last" },
        ]);
    });

    test("reports an incomplete start/end selection until two distinct connected images exist", async () => {
        const { buildNodeGenerationInputs, isCanvasStartEndFrameSelectionComplete, resolveCanvasStartEndFrameInputs } = await import("@/components/canvas/canvas-node-generation");
        const configNode: CanvasNodeData = {
            id: "video-config",
            type: CanvasNodeType.Config,
            title: "Video config",
            position: { x: 500, y: 300 },
            width: 420,
            height: 360,
            metadata: { generationMode: "video", videoMode: "start-end" },
        };
        const frame = imageNode("only-frame", "Only frame", "blob:only-frame");
        const inputs = buildNodeGenerationInputs(configNode.id, [configNode, frame], [{ id: "frame-config", fromNodeId: frame.id, toNodeId: configNode.id }]);

        expect(resolveCanvasStartEndFrameInputs(configNode, inputs)).toMatchObject({ first: { nodeId: "only-frame" }, last: undefined });
        expect(isCanvasStartEndFrameSelectionComplete(resolveCanvasStartEndFrameInputs(configNode, inputs))).toBeFalse();
    });

    test("keeps ordinary connected references unchanged outside start/end mode", async () => {
        const { buildNodeGenerationContext } = await import("@/components/canvas/canvas-node-generation");
        const configNode: CanvasNodeData = {
            id: "subject-config",
            type: CanvasNodeType.Config,
            title: "Subject config",
            position: { x: 500, y: 300 },
            width: 420,
            height: 360,
            metadata: { generationMode: "video", videoMode: "subject" },
        };
        const frameA = imageNode("subject-a", "A", "blob:subject-a");
        const frameB = imageNode("subject-b", "B", "blob:subject-b");
        const context = buildNodeGenerationContext(
            configNode.id,
            [configNode, frameA, frameB],
            [
                { id: "subject-a-config", fromNodeId: frameA.id, toNodeId: configNode.id },
                { id: "subject-b-config", fromNodeId: frameB.id, toNodeId: configNode.id },
            ],
            "keep all references",
        );

        expect(context.referenceImages.map((image) => image.id)).toEqual(["subject-a", "subject-b"]);
        expect(context.referenceImages.every((image) => image.videoRole === undefined)).toBeTrue();
    });

    test("collects image, video, and audio nodes for 2.0 omni reference mode", async () => {
        const { buildNodeGenerationContext } = await import("@/components/canvas/canvas-node-generation");
        const target: CanvasNodeData = {
            id: "omni-video",
            type: CanvasNodeType.Video,
            title: "Omni video",
            position: { x: 500, y: 300 },
            width: 420,
            height: 236,
            metadata: { content: "", status: "idle", model: "doubao-seedance-2-0-260128", videoMode: "subject" },
        };
        const image = imageNode("omni-image", "Image", "blob:omni-image");
        const video: CanvasNodeData = {
            id: "omni-reference-video",
            type: CanvasNodeType.Video,
            title: "Reference video",
            position: { x: 100, y: 300 },
            width: 420,
            height: 236,
            metadata: { content: "blob:omni-video", status: "success", mimeType: "video/mp4" },
        };
        const audio: CanvasNodeData = {
            id: "omni-reference-audio",
            type: CanvasNodeType.Audio,
            title: "Reference audio",
            position: { x: 100, y: 500 },
            width: 340,
            height: 120,
            metadata: { content: "blob:omni-audio", status: "success", mimeType: "audio/mpeg" },
        };
        const context = buildNodeGenerationContext(
            target.id,
            [target, image, video, audio],
            [
                { id: "omni-image-target", fromNodeId: image.id, toNodeId: target.id },
                { id: "omni-video-target", fromNodeId: video.id, toNodeId: target.id },
                { id: "omni-audio-target", fromNodeId: audio.id, toNodeId: target.id },
            ],
            "follow all references",
        );

        expect(context.referenceImages.map((item) => item.id)).toEqual(["omni-image"]);
        expect(context.referenceVideos.map((item) => item.id)).toEqual(["omni-reference-video"]);
        expect(context.referenceAudios.map((item) => item.id)).toEqual(["omni-reference-audio"]);
    });

    test("keeps every connected omni-reference asset when the canvas composer mentions only some of them", async () => {
        const { buildNodeGenerationContext } = await import("@/components/canvas/canvas-node-generation");
        const configNode: CanvasNodeData = {
            id: "composer-omni-config",
            type: CanvasNodeType.Config,
            title: "Omni config",
            position: { x: 500, y: 300 },
            width: 420,
            height: 360,
            metadata: {
                generationMode: "video",
                model: "doubao-seedance-2-0-260128",
                videoMode: "subject",
                composerContent: "make @[node:composer-video] follow @[node:composer-image]",
            },
        };
        const image = imageNode("composer-image", "Image", "blob:composer-image");
        const video: CanvasNodeData = {
            id: "composer-video",
            type: CanvasNodeType.Video,
            title: "Video",
            position: { x: 100, y: 300 },
            width: 420,
            height: 236,
            metadata: { content: "blob:composer-video", status: "success", mimeType: "video/mp4" },
        };
        const audio: CanvasNodeData = {
            id: "composer-audio",
            type: CanvasNodeType.Audio,
            title: "Audio",
            position: { x: 100, y: 500 },
            width: 340,
            height: 120,
            metadata: { content: "blob:composer-audio", status: "success", mimeType: "audio/mpeg" },
        };
        const context = buildNodeGenerationContext(
            configNode.id,
            [configNode, image, video, audio],
            [
                { id: "composer-image-config", fromNodeId: image.id, toNodeId: configNode.id },
                { id: "composer-video-config", fromNodeId: video.id, toNodeId: configNode.id },
                { id: "composer-audio-config", fromNodeId: audio.id, toNodeId: configNode.id },
            ],
            configNode.metadata?.composerContent || "",
            { includeAllMediaReferences: true },
        );

        expect(context.prompt).toBe("make @视频1 follow @图片1");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["composer-image"]);
        expect(context.referenceVideos.map((item) => item.id)).toEqual(["composer-video"]);
        expect(context.referenceAudios.map((item) => item.id)).toEqual(["composer-audio"]);
    });
});

function imageNode(id: string, title: string, content: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title,
        position: { x: 100, y: 100 },
        width: 340,
        height: 240,
        metadata: { content, status: "success", mimeType: "image/png" },
    };
}
