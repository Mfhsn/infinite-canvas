import { afterEach, describe, expect, test } from "bun:test";

import { downloadBlobForStorage } from "@/services/file-storage";
import { capturePlatformSessionBinding, clearPlatformSessionBinding } from "@/services/platform-session";
import { resetStorageRuntimeForTests } from "@/services/storage/runtime";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

afterEach(() => {
    globalThis.fetch = originalFetch;
    clearPlatformSessionBinding();
    restoreGlobal("window", originalWindow);
    restoreGlobal("document", originalDocument);
    resetStorageRuntimeForTests();
});

describe("generated media persistence", () => {
    test("sends the platform session binding when downloading same-origin generated media", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { "X-Canvas-Session-Binding": "binding-media" } }));
        let requestInit: RequestInit | undefined;
        globalThis.fetch = (async (_input, init) => {
            requestInit = init;
            return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } });
        }) as typeof fetch;

        const blob = await downloadBlobForStorage("/__dream_media_proxy?url=generated");

        expect(blob.type).toBe("image/png");
        expect(requestInit?.credentials).toBe("include");
        expect(new Headers(requestInit?.headers).get("X-Canvas-Session-Binding")).toBe("binding-media");
    });

    test("does not send the platform session binding to an external media URL", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { "X-Canvas-Session-Binding": "binding-media" } }));
        let requestInit: RequestInit | undefined;
        globalThis.fetch = (async (_input, init) => {
            requestInit = init;
            return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "image/png" } });
        }) as typeof fetch;

        await downloadBlobForStorage("https://cdn.example.test/generated.png");

        expect(requestInit?.credentials).toBe("omit");
        expect(requestInit?.headers).toBeUndefined();
    });

    test("rejects failed remote downloads instead of storing an error response", async () => {
        globalThis.fetch = (async () => new Response("expired", { status: 403 })) as typeof fetch;
        await expect(downloadBlobForStorage("https://media.example.test/expired.mp4")).rejects.toThrow("Media download failed (403)");
    });

    test("downloads URL-only video results and writes them through the MySQL blob API", async () => {
        const { storeGeneratedVideo } = await import("@/services/api/video");
        let uploaded: Blob | undefined;
        let storageKey = "";
        installBrowserMediaGlobals();
        globalThis.fetch = (async (input, init) => {
            const url = String(input);
            if (url === "https://media.example.test/generated.mp4") {
                return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "application/octet-stream" } });
            }
            if (url === "/api/storage/config") return Response.json({ driver: "mysql", namespace: "default" });
            if (url.startsWith("/api/storage/blobs/") && init?.method === "PUT") {
                uploaded = init.body as Blob;
                storageKey = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
                return Response.json({ blob: { key: storageKey, mimeType: uploaded.type, byteSize: uploaded.size, createdAt: "", updatedAt: "" } });
            }
            if (url.startsWith("/api/storage/blobs/") && init?.method === "HEAD") return new Response(null, { status: 200 });
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const stored = await storeGeneratedVideo({ url: "https://media.example.test/generated.mp4", mimeType: "video/mp4" });

        expect(storageKey).toStartWith("video:");
        expect(stored.storageKey).toBe(storageKey);
        expect(stored.url).toBe(`/api/storage/blobs/${encodeURIComponent(storageKey)}`);
        expect(stored.mimeType).toBe("video/mp4");
        expect(stored.bytes).toBe(4);
        expect(uploaded?.type).toBe("video/mp4");
    });
});

function installBrowserMediaGlobals() {
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => {
                const media = {
                    videoWidth: 1920,
                    videoHeight: 1080,
                    duration: 4,
                    onloadedmetadata: undefined as (() => void) | undefined,
                    onerror: undefined as (() => void) | undefined,
                    set src(_value: string) {
                        this.onloadedmetadata?.();
                    },
                };
                return media;
            },
        },
    });
}

function restoreGlobal(name: "window" | "document", descriptor: PropertyDescriptor | undefined) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
}
