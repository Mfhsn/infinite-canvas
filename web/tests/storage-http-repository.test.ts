import { afterEach, describe, expect, test } from "bun:test";

import { HttpBlobRepository, HttpDocumentRepository } from "@/services/storage/http-repository";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
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
        expect(calls[2].init?.headers).toEqual({ "If-Match": "4" });
    });

    test("uses HEAD before resolving a stable media URL", async () => {
        globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
        const repository = new HttpBlobRepository();
        expect(await repository.resolveUrl("video:demo")).toBe("/api/storage/blobs/video%3Ademo");
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
