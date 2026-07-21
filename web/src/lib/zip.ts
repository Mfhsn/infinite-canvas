import { Unzip, UnzipInflate, zipSync } from "fflate";

export const ZIP_LIMITS = {
    compressedBytes: 512 * 1024 * 1024,
    entries: 10_000,
    entryBytes: 256 * 1024 * 1024,
    totalBytes: 1024 * 1024 * 1024,
} as const;

type ZipFile = {
    name: string;
    data: BlobPart;
};

export type ReadZipOptions = Partial<typeof ZIP_LIMITS>;

export async function createZip(files: ZipFile[]) {
    const seen = new Set<string>();
    const entries = await Promise.all(
        files.map(async (file) => {
            const name = normalizeZipPath(file.name);
            if (seen.has(name)) throw new Error(`Duplicate ZIP path: ${name}`);
            seen.add(name);
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [name, data] as const;
        }),
    );
    return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

/**
 * Reads ZIP entries with streaming output accounting. fflate cannot guarantee
 * protection before all inflater allocations (and ZIP metadata is not always
 * trustworthy), so limits are enforced from metadata when available and again
 * on every emitted output chunk, aborting as soon as a violation is observed.
 */
export async function readZip(file: Blob, options: ReadZipOptions = {}) {
    const limits = { ...ZIP_LIMITS, ...options };
    if (file.size > limits.compressedBytes) throw new Error(`ZIP exceeds compressed size limit (${limits.compressedBytes} bytes)`);

    const input = new Uint8Array(await file.arrayBuffer());
    const entries = new Map<string, Blob>();
    const paths = new Set<string>();
    let entryCount = 0;
    let totalBytes = 0;
    let pendingFiles = 0;
    let inputComplete = false;

    return await new Promise<Map<string, Blob>>((resolve, reject) => {
        let settled = false;
        const fail = (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
        };
        const finish = () => {
            if (settled || !inputComplete || pendingFiles !== 0) return;
            settled = true;
            resolve(entries);
        };
        const unzip = new Unzip((entry) => {
            if (settled) return;
            try {
                entryCount += 1;
                if (entryCount > limits.entries) throw new Error(`ZIP exceeds entry limit (${limits.entries})`);
                const path = normalizeZipPath(entry.name);
                if (paths.has(path)) throw new Error(`Duplicate ZIP path: ${path}`);
                paths.add(path);
                if (entry.originalSize !== undefined && entry.originalSize > limits.entryBytes) {
                    throw new Error(`ZIP entry exceeds size limit: ${path}`);
                }
                if (entry.originalSize !== undefined && totalBytes + entry.originalSize > limits.totalBytes) {
                    throw new Error(`ZIP exceeds total uncompressed size limit (${limits.totalBytes} bytes)`);
                }

                pendingFiles += 1;
                const chunks: Uint8Array[] = [];
                let entryBytes = 0;
                entry.ondata = (error, chunk, final) => {
                    if (settled) return;
                    if (error) {
                        fail(error);
                        return;
                    }
                    entryBytes += chunk.length;
                    totalBytes += chunk.length;
                    if (entryBytes > limits.entryBytes) {
                        entry.terminate();
                        fail(new Error(`ZIP entry exceeds size limit: ${path}`));
                        return;
                    }
                    if (totalBytes > limits.totalBytes) {
                        entry.terminate();
                        fail(new Error(`ZIP exceeds total uncompressed size limit (${limits.totalBytes} bytes)`));
                        return;
                    }
                    if (chunk.length) chunks.push(chunk.slice());
                    if (!final) return;
                    entries.set(path, new Blob(chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer)));
                    pendingFiles -= 1;
                    finish();
                };
                entry.start();
            } catch (error) {
                entry.terminate();
                fail(error);
            }
        });
        unzip.register(UnzipInflate);

        try {
            const chunkBytes = 64 * 1024;
            if (input.length === 0) unzip.push(input, true);
            for (let offset = 0; offset < input.length && !settled; offset += chunkBytes) {
                const end = Math.min(offset + chunkBytes, input.length);
                unzip.push(input.subarray(offset, end), end === input.length);
            }
            inputComplete = true;
            finish();
        } catch (error) {
            fail(error);
        }
    });
}

export function normalizeZipPath(name: string) {
    if (!name || name.includes("\0")) throw new Error("Invalid ZIP path");
    if (name.includes("\\")) throw new Error(`ZIP path contains a backslash: ${name}`);
    if (name.startsWith("/") || name.startsWith("//") || /^[A-Za-z]:/.test(name)) throw new Error(`ZIP path is absolute: ${name}`);

    const segments = name.split("/");
    if (segments.includes("..")) throw new Error(`ZIP path contains parent traversal: ${name}`);
    const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
    if (!normalized) throw new Error(`Invalid ZIP path: ${name}`);
    return normalized;
}
