import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const CANVAS_COVER_WIDTH = 640;
export const CANVAS_COVER_HEIGHT = 360;
export const CANVAS_COVER_WEBP_QUALITY = 0.82;
const COVER_MEDIA_TIMEOUT_MS = 15_000;

export type CanvasCoverCandidate = {
    id: string;
    kind: "image" | "video";
    source: string;
    poster?: string;
};

type CoverDrawable = {
    source: CanvasImageSource;
    width: number;
    height: number;
};

export type CanvasCoverEncodingAdapters = {
    createCanvas: () => HTMLCanvasElement;
    loadImage: (source: string) => Promise<CoverDrawable>;
    loadVideoFrame: (source: string) => Promise<CoverDrawable>;
};

export function createCanvasCoverKey(projectId: string, revisionOrId: string) {
    if (!projectId || !revisionOrId) throw new Error("Canvas cover key requires a project id and revision");
    return `canvas-cover:${projectId}:${revisionOrId}`;
}

export function selectCanvasCoverCandidate(nodes: CanvasNodeData[]): CanvasCoverCandidate | null {
    const successful = nodes.filter((node) => node.metadata?.status === "success");
    const image = findLastNode(successful, CanvasNodeType.Image);
    if (image?.metadata?.content) return { id: image.id, kind: "image", source: image.metadata.content };

    const video = findLastNode(successful, CanvasNodeType.Video);
    if (!video?.metadata?.content) return null;
    const metadata = video.metadata as typeof video.metadata & { poster?: string; posterUrl?: string; thumbnail?: string; thumbnailUrl?: string };
    return {
        id: video.id,
        kind: "video",
        source: video.metadata.content,
        poster: metadata.poster || metadata.posterUrl || metadata.thumbnail || metadata.thumbnailUrl,
    };
}

function findLastNode(nodes: CanvasNodeData[], type: CanvasNodeType) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.type === type && node.metadata?.content) return node;
    }
    return undefined;
}

export async function createCanvasCoverBlob(candidate: CanvasCoverCandidate, adapters: Partial<CanvasCoverEncodingAdapters> = {}) {
    const browserAdapters = createBrowserAdapters();
    const resolved = { ...browserAdapters, ...adapters };
    const drawable = candidate.kind === "image" || candidate.poster ? await resolved.loadImage(candidate.poster || candidate.source) : await resolved.loadVideoFrame(candidate.source);
    const canvas = resolved.createCanvas();
    canvas.width = CANVAS_COVER_WIDTH;
    canvas.height = CANVAS_COVER_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas cover encoding context is unavailable");

    const scale = Math.max(CANVAS_COVER_WIDTH / drawable.width, CANVAS_COVER_HEIGHT / drawable.height);
    const width = drawable.width * scale;
    const height = drawable.height * scale;
    context.drawImage(drawable.source, (CANVAS_COVER_WIDTH - width) / 2, (CANVAS_COVER_HEIGHT - height) / 2, width, height);

    const webp = await canvasToBlob(canvas, "image/webp", CANVAS_COVER_WEBP_QUALITY);
    if (webp?.size && webp.type === "image/webp") return webp;
    const png = await canvasToBlob(canvas, "image/png");
    if (!png?.size) throw new Error("Canvas cover encoding failed");
    return png;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function createBrowserAdapters(): CanvasCoverEncodingAdapters {
    return {
        createCanvas: () => document.createElement("canvas"),
        loadImage: (source) =>
            new Promise((resolve, reject) => {
                const image = new Image();
                const timer = globalThis.setTimeout(() => fail(), COVER_MEDIA_TIMEOUT_MS);
                const cleanup = () => {
                    globalThis.clearTimeout(timer);
                    image.onload = null;
                    image.onerror = null;
                };
                const fail = () => {
                    cleanup();
                    reject(new Error("Canvas cover image could not be loaded"));
                };
                image.onload = () => {
                    cleanup();
                    resolve({ source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
                };
                image.onerror = fail;
                image.src = source;
            }),
        loadVideoFrame: (source) =>
            new Promise((resolve, reject) => {
                const video = document.createElement("video");
                let settled = false;
                const timer = globalThis.setTimeout(() => fail(), COVER_MEDIA_TIMEOUT_MS);
                const cleanup = () => {
                    globalThis.clearTimeout(timer);
                    video.onerror = null;
                    video.onloadeddata = null;
                    video.onseeked = null;
                };
                const fail = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(new Error("Canvas cover video frame could not be loaded"));
                };
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve({ source: video, width: video.videoWidth || 1280, height: video.videoHeight || 720 });
                };
                video.muted = true;
                video.playsInline = true;
                video.preload = "auto";
                video.onerror = fail;
                video.onloadeddata = () => {
                    const duration = Number.isFinite(video.duration) ? video.duration : 0;
                    const safeTime = duration > 0.2 ? Math.min(Math.max(duration * 0.05, 0.1), Math.max(duration - 0.1, 0)) : 0;
                    if (!safeTime) finish();
                    else {
                        video.onseeked = finish;
                        video.currentTime = safeTime;
                    }
                };
                video.src = source;
            }),
    };
}
