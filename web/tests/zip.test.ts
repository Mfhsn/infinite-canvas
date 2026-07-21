import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";

import { createZip, readZip, ZIP_LIMITS } from "@/lib/zip";

describe("ZIP safety", () => {
    test("uses the archive protocol limits", () => {
        expect(ZIP_LIMITS).toEqual({
            compressedBytes: 512 * 1024 * 1024,
            entries: 10_000,
            entryBytes: 256 * 1024 * 1024,
            totalBytes: 1024 * 1024 * 1024,
        });
    });

    test("round-trips safe entries", async () => {
        const zip = await createZip([
            { name: "projects.json", data: "{}" },
            { name: "projects/one/files/image.png", data: new Uint8Array([1, 2, 3]) },
        ]);

        const entries = await readZip(zip);

        expect(await entries.get("projects.json")?.text()).toBe("{}");
        expect(new Uint8Array(await entries.get("projects/one/files/image.png")!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    test.each([
        ["/absolute.txt", "absolute"],
        ["C:/absolute.txt", "absolute"],
        ["folder/../escape.txt", "parent traversal"],
        ["folder\\escape.txt", "backslash"],
        ["nul\0name.txt", "Invalid ZIP path"],
    ])("rejects malicious path %s", async (name, message) => {
        const zip = zipBlob({ [name]: new Uint8Array([1]) });
        await expect(readZip(zip)).rejects.toThrow(message);
    });

    test("rejects duplicate paths after normalization", async () => {
        const zip = zipBlob({ "same.txt": new Uint8Array([1]), "./same.txt": new Uint8Array([2]) });
        await expect(readZip(zip)).rejects.toThrow("Duplicate ZIP path: same.txt");
    });

    test("rejects compressed, entry-count, single-entry, and cumulative limits", async () => {
        const smallZip = zipBlob({ "a.txt": new Uint8Array([1]), "b.txt": new Uint8Array([2]) });
        await expect(readZip(smallZip, { compressedBytes: smallZip.size - 1 })).rejects.toThrow("compressed size limit");
        await expect(readZip(smallZip, { entries: 1 })).rejects.toThrow("entry limit");
        await expect(readZip(smallZip, { entryBytes: 0 })).rejects.toThrow("entry exceeds size limit");
        await expect(readZip(smallZip, { totalBytes: 1 })).rejects.toThrow("total uncompressed size limit");
    });

    test("stops a highly compressed entry when actual or declared output crosses the limit", async () => {
        const compressed = zipBlob({ "bomb.bin": new Uint8Array(64 * 1024) });
        await expect(readZip(compressed, { entryBytes: 1024 })).rejects.toThrow("entry exceeds size limit");
    });
});

function zipBlob(entries: Record<string, Uint8Array>) {
    return new Blob([zipSync(entries, { level: 6 })], { type: "application/zip" });
}
