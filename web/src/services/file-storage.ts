import { nanoid } from "nanoid";
import { getBlobRepository } from "@/services/storage/runtime";
import { withPlatformSessionBinding } from "@/services/platform-session";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await downloadBlobForStorage(input) : input;
    const storageKey = `${prefix}:${nanoid()}`;
    const repository = await getBlobRepository();
    await repository.put(storageKey, blob);
    const url = (await repository.resolveUrl(storageKey)) || URL.createObjectURL(blob);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

export async function downloadBlobForStorage(url: string, fallbackMimeType = "") {
    const sameOrigin = isSameOriginUrl(url);
    const response = await fetch(url, {
        credentials: sameOrigin ? "include" : "omit",
        ...(sameOrigin ? { headers: withPlatformSessionBinding() } : {}),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const suffix = detail.trim() ? `: ${detail.trim().slice(0, 240)}` : "";
        throw new Error(`Media download failed (${response.status})${suffix}`);
    }
    const blob = await response.blob();
    if (!fallbackMimeType || (blob.type && blob.type !== "application/octet-stream")) return blob;
    return new Blob([blob], { type: fallbackMimeType });
}

function isSameOriginUrl(value: string) {
    if (value.startsWith("/")) return true;
    if (/^(?:data|blob):/i.test(value) || typeof window === "undefined") return false;
    try {
        const location = window.location;
        return Boolean(location?.origin && new URL(value, location.href).origin === location.origin);
    } catch {
        return false;
    }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return (await (await getBlobRepository()).resolveUrl(storageKey)) || fallback;
}

export async function getMediaBlob(storageKey: string) {
    return (await getBlobRepository()).get(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    const repository = await getBlobRepository();
    await repository.put(storageKey, blob);
    return (await repository.resolveUrl(storageKey)) || URL.createObjectURL(blob);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    const repository = await getBlobRepository();
    await Promise.all(Array.from(new Set(keys)).map((key) => repository.delete(key)));
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    const files = await (await getBlobRepository()).list();
    files.forEach(({ storageKey }) => {
        if (!storageKey.startsWith("image:") && !usedKeys.has(storageKey)) unused.push(storageKey);
    });
    await deleteStoredMedia(unused);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
