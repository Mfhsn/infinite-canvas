import axios from "axios";
import { nanoid } from "nanoid";

import { audioMimeType, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { DREAM_API_MODELS, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = { signal?: AbortSignal };
type DreamApiEnvelope<T = unknown> = { code?: number; message?: string; msg?: string; data?: T | null; error?: { message?: string } };

const DEFAULT_IMAGE_SIZE = 1024;

export function fetchDreamModels() {
    return [...DREAM_API_MODELS].sort((a, b) => a.localeCompare(b));
}

export async function requestDreamImageGeneration(config: AiConfig, prompt: string, count: number, options?: RequestOptions) {
    const { width, height } = dreamImageDimensions(config.size);
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/dream_image"),
        {
            project_id: 0,
            dream_image_req_key: modelOptionName(config.model),
            script_text: prompt,
            width,
            height,
            num_images: count,
            platform_id: 0,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    return dreamImagesFromPayload(response.data, config.baseUrl);
}

export async function requestDreamImageEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, count = 1, options?: RequestOptions) {
    if (mask) return requestDreamInpainting(config, prompt, references, mask, options);
    if (modelOptionName(config.model).toLowerCase().includes("outpainting")) return requestDreamOutpainting(config, prompt, references, options);
    const { width, height } = dreamImageDimensions(config.size);
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/dream_image"),
        {
            project_id: 0,
            dream_image_req_key: modelOptionName(config.model),
            image_asset_ids: await dreamImageAssetIds(references),
            script_text: prompt,
            width,
            height,
            num_images: count,
            platform_id: 0,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    return dreamImagesFromPayload(response.data, config.baseUrl);
}

export async function requestDreamVideoUrl(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions) {
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/dream_video"),
        {
            platform_id: 0,
            project_id: 0,
            action_type: "",
            dream_video_req_key: modelOptionName(config.model),
            image_asset_ids: await dreamImageAssetIds(references),
            script_text: prompt || null,
            aspect_ratio: dreamAspectRatio(config.size),
            duration: dreamVideoDuration(config.videoSeconds),
            audio: boolConfig(config.videoGenerateAudio, false),
            video_ids: await dreamMediaIds(videoReferences),
            audio_ids: await dreamMediaIds(audioReferences),
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    return firstDreamUrl(response.data, config.baseUrl, "Dream 视频接口没有返回视频 URL");
}

export async function requestDreamAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const voice = normalizeAudioVoiceValue(config.audioVoice);
    const response = await axios.post<DreamApiEnvelope | { audio_url?: string }>(
        dreamApiUrl(config, "/api/tts/synthesize"),
        {
            text: prompt,
            voice_id: voice,
            speaker_id: voice,
            speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
            volume: 1,
            pitch: 1,
            emotion: config.audioInstructions.trim() || undefined,
            filter_parenthesis: true,
            audio_category: "audio",
            platform_id: 0,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    const url = firstDreamUrl(response.data, config.baseUrl, "TTS 接口没有返回音频 URL");
    const blob = await dreamBlobFromUrl(url, options);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(config.audioFormat) });
}

function dreamApiUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    if (baseUrl.toLowerCase().endsWith("/api/v1") && path.startsWith("/api/v1/")) return `${baseUrl}${path.slice("/api/v1".length)}`;
    if (baseUrl.toLowerCase().endsWith("/api") && path.startsWith("/api/")) return `${baseUrl}${path.slice("/api".length)}`;
    return `${baseUrl}${path}`;
}

function dreamHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "Content-Type": "application/json",
        ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
    };
}

async function requestDreamInpainting(config: AiConfig, prompt: string, references: ReferenceImage[], mask: ReferenceImage, options?: RequestOptions) {
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/inpainting_edit"),
        {
            project_id: 0,
            req_key: modelOptionName(config.model) || "i2i_inpainting_edit",
            task_type: "dream",
            image_asset_ids: await dreamImageAssetIds([...references, mask]),
            script_text: prompt,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    return dreamImagesFromPayload(response.data, config.baseUrl);
}

async function requestDreamOutpainting(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/outpainting"),
        {
            project_id: 0,
            req_key: modelOptionName(config.model) || "i2i_outpainting",
            task_type: "dream",
            image_asset_ids: await dreamImageAssetIds(references),
            script_text: prompt || null,
            top: 0.1,
            bottom: 0.1,
            left: 0.1,
            right: 0.1,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    return dreamImagesFromPayload(response.data, config.baseUrl);
}

function dreamImagesFromPayload(payload: unknown, baseUrl: string) {
    const urls = dreamUrls(payload, baseUrl);
    if (!urls.length) throw new Error("Dream 图片接口没有返回图片 URL");
    return urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

function firstDreamUrl(payload: unknown, baseUrl: string, fallback: string) {
    const url = dreamUrls(payload, baseUrl)[0];
    if (!url) throw new Error(fallback);
    return url;
}

function dreamUrls(payload: unknown, baseUrl: string) {
    const data = unwrapDreamPayload(payload);
    return collectDreamStrings(data).map((url) => absoluteDreamUrl(baseUrl, url));
}

function unwrapDreamPayload(payload: unknown): unknown {
    if (!isRecord(payload)) return payload;
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(stringValue(payload.message) || stringValue(payload.msg) || "Dream 接口请求失败");
    if (isRecord(payload.error) && payload.error.message) throw new Error(String(payload.error.message));
    return "data" in payload ? payload.data : payload;
}

function collectDreamStrings(value: unknown): string[] {
    if (!value) return [];
    if (typeof value === "string") {
        const text = value.trim();
        if (!text) return [];
        const parsed = parseJson(text);
        return parsed === text ? [text] : collectDreamStrings(parsed);
    }
    if (Array.isArray(value)) return value.flatMap(collectDreamStrings);
    if (!isRecord(value)) return [];
    const keys = ["url", "image_url", "imageUrl", "audio_url", "audioUrl", "video_url", "videoUrl", "dataUrl", "result", "output", "data", "images", "audios", "videos", "urls", "files"];
    return keys.flatMap((key) => collectDreamStrings(value[key]));
}

function parseJson(value: string): unknown {
    if (!value.startsWith("{") && !value.startsWith("[")) return value;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}

function absoluteDreamUrl(baseUrl: string, value: string) {
    if (/^(https?:|data:|blob:|asset:\/\/)/i.test(value)) return value;
    const base = baseUrl.trim();
    if (!base) return value;
    try {
        return new URL(value, base.endsWith("/") ? base : `${base}/`).toString();
    } catch {
        return value;
    }
}

async function dreamImageAssetIds(images: ReferenceImage[]) {
    const ids = await Promise.all(
        images.map(async (image) => {
            if (image.url && !image.url.startsWith("blob:")) return image.url;
            if (image.dataUrl && !image.dataUrl.startsWith("blob:")) return image.dataUrl;
            return imageToDataUrl(image);
        }),
    );
    return optionalList(ids);
}

async function dreamMediaIds(items: Array<ReferenceVideo | ReferenceAudio>) {
    const ids = await Promise.all(
        items.map(async (item) => {
            if (item.url && !item.url.startsWith("blob:")) return item.url;
            if (item.storageKey) {
                const blob = await getMediaBlob(item.storageKey);
                return blob ? blobToDataUrl(blob) : item.storageKey;
            }
            if (item.url) return item.url;
            return "";
        }),
    );
    return optionalList(ids);
}

function optionalList(values: Array<string | null | undefined>) {
    const list = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    return list.length ? list : undefined;
}

function dreamImageDimensions(size: string) {
    const dimensions = size.match(/^(\d+)x(\d+)$/i);
    if (dimensions) return { width: Number(dimensions[1]), height: Number(dimensions[2]) };
    const ratio = size.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!ratio) return { width: DEFAULT_IMAGE_SIZE, height: DEFAULT_IMAGE_SIZE };
    const widthRatio = Number(ratio[1]);
    const heightRatio = Number(ratio[2]);
    if (!widthRatio || !heightRatio) return { width: DEFAULT_IMAGE_SIZE, height: DEFAULT_IMAGE_SIZE };
    if (widthRatio >= heightRatio) return { width: DEFAULT_IMAGE_SIZE, height: Math.round((DEFAULT_IMAGE_SIZE * heightRatio) / widthRatio) };
    return { width: Math.round((DEFAULT_IMAGE_SIZE * widthRatio) / heightRatio), height: DEFAULT_IMAGE_SIZE };
}

function dreamAspectRatio(size: string) {
    if (/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(size)) return size;
    const dimensions = size.match(/^(\d+)x(\d+)$/i);
    if (!dimensions) return "";
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (!width || !height) return "";
    return `${Math.round(width / gcd(width, height))}:${Math.round(height / gcd(width, height))}`;
}

function dreamVideoDuration(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return seconds > 5 ? 10 : 5;
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : a;
}

function boolConfig(value: string, fallback: boolean) {
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

async function dreamBlobFromUrl(url: string, options?: RequestOptions) {
    if (url.startsWith("data:") || url.startsWith("blob:")) return fetch(url, { signal: options?.signal }).then((response) => response.blob());
    const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
    return response.data;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取素材失败"));
        reader.readAsDataURL(blob);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}
