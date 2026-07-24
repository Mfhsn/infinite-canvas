import { AppError } from "@/lib/app-error";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { downloadBlobForStorage } from "@/services/file-storage";
import { getBlobRepository } from "@/services/storage/runtime";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await downloadBlobForStorage(input) : input;
    const storageKey = `image:${nanoid()}`;
    const repository = await getBlobRepository();
    await repository.put(storageKey, blob);
    const url = (await repository.resolveUrl(storageKey)) || URL.createObjectURL(blob);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return (await (await getBlobRepository()).resolveUrl(storageKey)) || fallback;
}

export async function getImageBlob(storageKey: string) {
    return (await getBlobRepository()).get(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    const repository = await getBlobRepository();
    await repository.put(storageKey, blob);
    return (await repository.resolveUrl(storageKey)) || URL.createObjectURL(blob);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await downloadBlobForStorage(url));
}

export async function deleteStoredImages(keys: Iterable<string>) {
    const repository = await getBlobRepository();
    await Promise.all(Array.from(new Set(keys)).map((key) => repository.delete(key)));
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    const files = await (await getBlobRepository()).list();
    files.forEach(({ storageKey }) => {
        if (storageKey.startsWith("image:") && !usedKeys.has(storageKey)) unused.push(storageKey);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new AppError("error.image.readFailed"));
        reader.readAsDataURL(blob);
    });
}
