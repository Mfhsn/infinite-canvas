import { afterEach, describe, expect, test } from "bun:test";

import { normalizeCanvasFolder, normalizeCanvasProject } from "@/lib/canvas/canvas-library";
import { collectStorageKeysForDomain, normalizeManifestBusinessContent, parseAppSyncManifest, syncAppDataToWebdav, type AppSyncDomainKey, type DomainManifest } from "@/services/app-sync";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    useCanvasStore.setState({ projects: [], hydrated: true, hydrationStatus: "success" });
    useCanvasFolderStore.setState({ folders: [], hydrated: true, hydrationStatus: "success" });
});

describe("canvas library WebDAV manifests", () => {
    test("accepts legacy commitId omission and rejects invalid commit ids", () => {
        const legacy = manifest("canvas", { projects: [project("local", "2026-01-01T00:00:00.000Z")] });
        delete legacy.commitId;
        expect(parseAppSyncManifest(legacy, "canvas").commitId).toBeUndefined();

        for (const commitId of ["", "   ", 42, "x".repeat(129)]) {
            expect(() => parseAppSyncManifest({ ...legacy, commitId }, "canvas")).toThrow();
        }
    });

    test("normalizes folder manifests with remove-wins and ignores commitId in business comparison", () => {
        const active = folder("folder", "9");
        const deleted = { ...folder("folder", "4"), deletedAt: "5" };
        const parsed = parseAppSyncManifest(manifest("canvas-folders", { folders: [active, deleted] }), "canvas-folders") as DomainManifest<{ folders: ReturnType<typeof normalizeCanvasFolder>[] }>;
        expect(parsed.data.folders).toEqual([normalizeCanvasFolder(deleted)]);

        const reordered = { ...parsed, commitId: "another", files: [...parsed.files].reverse() };
        expect(normalizeManifestBusinessContent(reordered)).toBe(normalizeManifestBusinessContent(parsed));
    });

    test("collects only matching versioned canvas covers", () => {
        const source = {
            projects: [
                { ...project("project", "1"), coverStorageKey: "canvas-cover:project:revision" },
                { ...project("other", "1"), coverStorageKey: "canvas-cover:project:wrong-owner" },
            ],
        };
        expect(collectStorageKeysForDomain("canvas", source)).toEqual(["canvas-cover:project:revision"]);
        const normalized = { projects: source.projects.map(normalizeCanvasProject) };
        expect(collectStorageKeysForDomain("canvas", normalized)).toEqual(["canvas-cover:project:revision"]);
    });

    test("uses If-Match and retries 412 by rereading and creating a fresh commitId", async () => {
        useCanvasStore.setState({ projects: [project("local", "2026-01-02T00:00:00.000Z")], hydrated: true, hydrationStatus: "success" });
        const putHeaders: string[] = [];
        const commitIds: string[] = [];
        let puts = 0;
        let reads = 0;
        globalThis.fetch = async (_input, init) => {
            const method = init?.method || "GET";
            if (method === "MKCOL") return new Response(null, { status: 201 });
            if (method === "GET") {
                reads += 1;
                return jsonResponse(manifest("canvas", { projects: [project(`remote-${reads}`, `2026-01-0${reads}T00:00:00.000Z`)] }), 200, { ETag: `"v${reads}"` });
            }
            if (method === "PUT") {
                puts += 1;
                const headers = new Headers(init?.headers);
                putHeaders.push(headers.get("If-Match") || "");
                commitIds.push(JSON.parse(await (init?.body as Blob).text()).commitId);
                return puts <= 3 ? new Response(null, { status: 412 }) : new Response(null, { status: 204, headers: { ETag: '"saved"' } });
            }
            throw new Error(`Unexpected ${method}`);
        };

        const result = await syncAppDataToWebdav(config("etag-retry"), undefined, ["canvas"]);
        expect(result.failedDomains).toEqual([]);
        expect(puts).toBe(4);
        expect(reads).toBe(4);
        expect(putHeaders).toEqual(['"v1"', '"v2"', '"v3"', '"v4"']);
        expect(new Set(commitIds).size).toBe(4);
    });

    test("fails a no-ETag domain when read-after-write commitId differs", async () => {
        useCanvasFolderStore.setState({ folders: [folder("local", "2")], hydrated: true, hydrationStatus: "success" });
        let stored: DomainManifest | undefined;
        let reads = 0;
        globalThis.fetch = async (_input, init) => {
            const method = init?.method || "GET";
            if (method === "MKCOL") return new Response(null, { status: 201 });
            if (method === "GET") {
                reads += 1;
                if (reads === 1) return jsonResponse(manifest("canvas-folders", { folders: [] }));
                return jsonResponse({ ...stored!, commitId: "concurrent-writer" });
            }
            if (method === "PUT") {
                stored = JSON.parse(await (init?.body as Blob).text());
                expect(new Headers(init?.headers).has("If-Match")).toBe(false);
                return new Response(null, { status: 204 });
            }
            throw new Error(`Unexpected ${method}`);
        };

        const result = await syncAppDataToWebdav(config("weak-mismatch"), undefined, ["canvas-folders"]);
        expect(result.completedDomains).toEqual([]);
        expect(result.failedDomains).toEqual(["canvas-folders"]);
    });

    test("verifies normalized business content after a no-ETag write", async () => {
        useCanvasFolderStore.setState({ folders: [folder("local", "2")], hydrated: true, hydrationStatus: "success" });
        let stored: DomainManifest | undefined;
        let reads = 0;
        globalThis.fetch = async (_input, init) => {
            const method = init?.method || "GET";
            if (method === "MKCOL") return new Response(null, { status: 201 });
            if (method === "GET") {
                reads += 1;
                if (reads === 1) return jsonResponse(manifest("canvas-folders", { folders: [] }));
                return jsonResponse({ ...stored!, data: { folders: [folder("different", "3")] } });
            }
            if (method === "PUT") {
                stored = JSON.parse(await (init?.body as Blob).text());
                return new Response(null, { status: 204 });
            }
            throw new Error(`Unexpected ${method}`);
        };

        const result = await syncAppDataToWebdav(config("weak-content-mismatch"), undefined, ["canvas-folders"]);
        expect(result.failedDomains).toEqual(["canvas-folders"]);
    });

    test("uses If-None-Match when creating a missing manifest", async () => {
        useCanvasFolderStore.setState({ folders: [folder("local", "2")], hydrated: true, hydrationStatus: "success" });
        let condition = "";
        globalThis.fetch = async (_input, init) => {
            const method = init?.method || "GET";
            if (method === "MKCOL") return new Response(null, { status: 201 });
            if (method === "GET") return new Response(null, { status: 404 });
            if (method === "PUT") {
                condition = new Headers(init?.headers).get("If-None-Match") || "";
                return new Response(null, { status: 204, headers: { ETag: '"created"' } });
            }
            throw new Error(`Unexpected ${method}`);
        };

        const result = await syncAppDataToWebdav(config("create-condition"), undefined, ["canvas-folders"]);
        expect(result.failedDomains).toEqual([]);
        expect(condition).toBe("*");
    });

    test("retries only a failed domain after a partial sync", async () => {
        useCanvasStore.setState({ projects: [project("canvas", "1")], hydrated: true, hydrationStatus: "success" });
        useCanvasFolderStore.setState({ folders: [folder("folder", "1")], hydrated: true, hydrationStatus: "success" });
        const putCounts: Record<string, number> = { canvas: 0, "canvas-folders": 0 };
        let folderShouldFail = true;
        globalThis.fetch = async (input, init) => {
            const method = init?.method || "GET";
            const url = String(input);
            const domain = (url.includes("canvas-folders") ? "canvas-folders" : "canvas") as AppSyncDomainKey;
            if (method === "MKCOL") return new Response(null, { status: 201 });
            if (method === "GET") return new Response(null, { status: 404 });
            if (method === "PUT") {
                putCounts[domain] += 1;
                if (domain === "canvas-folders" && folderShouldFail) return new Response("failed", { status: 500 });
                return new Response(null, { status: 204, headers: { ETag: '"saved"' } });
            }
            throw new Error(`Unexpected ${method}`);
        };

        const first = await syncAppDataToWebdav(config("partial"), undefined, ["canvas", "canvas-folders"]);
        expect(first.completedDomains).toEqual(["canvas"]);
        expect(first.failedDomains).toEqual(["canvas-folders"]);
        folderShouldFail = false;
        const retry = await syncAppDataToWebdav(config("partial"), undefined, first.failedDomains);
        expect(retry.failedDomains).toEqual([]);
        expect(putCounts.canvas).toBe(1);
        expect(putCounts["canvas-folders"]).toBe(2);
    });
});

function config(suffix: string): WebdavSyncConfig {
    return { url: `https://example.test/${suffix}`, directory: "sync", username: "", password: "", lastSyncedAt: "" };
}

function project(id: string, updatedAt: string) {
    return normalizeCanvasProject({ id, title: id, createdAt: "1", updatedAt, nodes: [], connections: [] });
}

function folder(id: string, updatedAt: string) {
    return normalizeCanvasFolder({ id, name: id, parentId: null, createdAt: "1", updatedAt });
}

function manifest(domain: AppSyncDomainKey, data: unknown): DomainManifest {
    return { app: "infinite-canvas", version: 1, domain, exportedAt: "2026-01-01T00:00:00.000Z", commitId: "commit", data, files: [] };
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}) {
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) } });
}
