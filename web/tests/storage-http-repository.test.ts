import { afterEach, describe, expect, test } from "bun:test";

import { HttpBlobRepository, HttpDocumentRepository } from "@/services/storage/http-repository";
import { CANVAS_SESSION_BINDING_HEADER, appendPlatformSessionBinding, capturePlatformSessionBinding, clearPlatformSessionBinding } from "@/services/platform-session";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    clearPlatformSessionBinding();
});

describe("HTTP storage repositories", () => {
    test("carries the latest document revision into updates and deletes", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const responses = [
            Response.json({ document: { key: "project:1", payload: { title: "one" }, revision: 3, createdAt: "", updatedAt: "" } }),
            Response.json({ document: { key: "project:1", payload: { title: "two" }, revision: 4, createdAt: "", updatedAt: "" } }),
            new Response(null, { status: 204 }),
        ];
        globalThis.fetch = (async (input, init) => {
            calls.push({ url: String(input), init });
            return responses.shift()!;
        }) as typeof fetch;

        const repository = new HttpDocumentRepository();
        await repository.get("canvas", "project:1");
        await repository.put("canvas", "project:1", { title: "two" });
        await repository.delete("canvas", "project:1");

        expect(calls[0].url).toBe("/api/storage/documents/canvas/project%3A1");
        expect(JSON.parse(String(calls[1].init?.body))).toEqual({ payload: { title: "two" }, revision: 3 });
        expect(new Headers(calls[2].init?.headers).get("If-Match")).toBe("4");
    });

    test("uses HEAD before resolving a stable media URL", async () => {
        globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
        const repository = new HttpBlobRepository();
        expect(await repository.resolveUrl("video:demo")).toBe("/api/storage/blobs/video%3Ademo");
    });

    test("sends binding on fetches and appends it to stable blob URLs", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "session/value+1" } }));
        let request: RequestInit | undefined;
        globalThis.fetch = (async (_input, init) => {
            request = init;
            return new Response(null, { status: 200 });
        }) as typeof fetch;

        const url = await new HttpBlobRepository().resolveUrl("video:demo");

        expect(new Headers(request?.headers).get(CANVAS_SESSION_BINDING_HEADER)).toBe("session/value+1");
        expect(request?.credentials).toBe("include");
        expect(url).toBe("/api/storage/blobs/video%3Ademo?session_binding=session%2Fvalue%2B1");
    });

    test("replaces a stale binding without duplicating query parameters", () => {
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-new" } }));

        expect(appendPlatformSessionBinding("/api/storage/blobs/image%3Ademo?download=1&session_binding=binding-old#preview")).toBe("/api/storage/blobs/image%3Ademo?download=1&session_binding=binding-new#preview");
    });

    test("recovers a rotated session binding and retries the storage request once", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-old" } }));
        const calls: Array<{ url: string; binding: string | null }> = [];
        globalThis.fetch = (async (input, init) => {
            const url = String(input);
            const binding = new Headers(init?.headers).get(CANVAS_SESSION_BINDING_HEADER);
            calls.push({ url, binding });
            if (url === "/api/platform/context") {
                return Response.json({ authenticated: true }, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-new" } });
            }
            if (calls.filter((call) => call.url.includes("/api/storage/blobs/")).length === 1) {
                return new Response(null, { status: 403 });
            }
            return new Response(null, { status: 200 });
        }) as typeof fetch;

        const url = await new HttpBlobRepository().resolveUrl("image:demo");

        expect(calls).toEqual([
            { url: "/api/storage/blobs/image%3Ademo", binding: "binding-old" },
            { url: "/api/platform/context", binding: null },
            { url: "/api/storage/blobs/image%3Ademo", binding: "binding-new" },
        ]);
        expect(url).toBe("/api/storage/blobs/image%3Ademo?session_binding=binding-new");
    });

    test("does not recover unrelated non-HEAD forbidden responses", async () => {
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-old" } }));
        const calls: string[] = [];
        globalThis.fetch = (async (input) => {
            calls.push(String(input));
            return Response.json({ error: { code: "forbidden", message: "Forbidden" } }, { status: 403 });
        }) as typeof fetch;

        await expect(new HttpBlobRepository().get("image:demo")).rejects.toMatchObject({ status: 403, code: "forbidden" });
        expect(calls).toEqual(["/api/storage/blobs/image%3Ademo"]);
    });

    test("reset clears remembered revisions", async () => {
        const requests: RequestInit[] = [];
        globalThis.fetch = (async (_input, init) => {
            requests.push(init || {});
            if (requests.length === 1) return Response.json({ document: { key: "project:1", payload: {}, revision: 7, createdAt: "", updatedAt: "" } });
            return Response.json({ document: { key: "project:1", payload: {}, revision: 1, createdAt: "", updatedAt: "" } });
        }) as typeof fetch;
        const repository = new HttpDocumentRepository();
        await repository.get("canvas", "project:1");
        repository.reset();
        await repository.put("canvas", "project:1", {});

        expect(JSON.parse(String(requests[1]?.body))).toEqual({ payload: {} });
    });

    test("submits collection changes through the transactional batch API", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        globalThis.fetch = (async (input, init) => {
            calls.push({ url: String(input), init });
            return Response.json({ documents: [{ key: "project-1", payload: { id: "project-1" }, revision: 1, createdAt: "", updatedAt: "" }], deleted: [] });
        }) as typeof fetch;
        const repository = new HttpDocumentRepository();
        await repository.batch("canvas", { puts: [{ key: "project-1", payload: { id: "project-1" }, revision: null }], deletes: [] });
        expect(calls[0].url).toBe("/api/storage/documents/canvas/batch");
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({ puts: [{ key: "project-1", payload: { id: "project-1" }, revision: null }], deletes: [] });
    });

    test("returns null for missing documents and blobs", async () => {
        globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
        expect(await new HttpDocumentRepository().get("assets", "missing")).toBeNull();
        expect(await new HttpBlobRepository().get("image:missing")).toBeNull();
    });

    test("rejects document keys the server cannot route", async () => {
        await expect(new HttpDocumentRepository().get("canvas", "project/1")).rejects.toThrow("cannot contain slashes");
    });

    test("passes an abort signal to every storage request", async () => {
        let signal: AbortSignal | null | undefined;
        globalThis.fetch = (async (_input, init) => {
            signal = init?.signal;
            return Response.json({ documents: [] });
        }) as typeof fetch;
        await new HttpDocumentRepository().list("canvas_folders");
        expect(signal).toBeInstanceOf(AbortSignal);
    });
});
