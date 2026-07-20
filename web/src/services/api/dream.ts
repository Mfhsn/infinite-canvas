import axios from "axios";
import { nanoid } from "nanoid";

import { ENV_AI_TASK_TIMEOUT_MS } from "@/constant/env";
import { audioMimeType, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { AppError, requestError } from "@/lib/app-error";
import { resolveDreamImageDimensions } from "@/lib/dream-image-size";
import { dataUrlToFile } from "@/lib/image-utils";
import { DREAM_SEEDANCE_15_MODEL, DREAM_SEEDANCE_20_MODEL, dreamOmniReferenceIssue, normalizeDreamVideoDuration, normalizeDreamVideoMode, normalizeDreamVideoRatio, normalizeDreamVideoSeed } from "@/lib/seedance-video";
import type { I18nKey } from "@/i18n/messages";
import { DREAM_API_PROXY_PATH, dreamApiProxyUrl, dreamMediaProxyUrl } from "@/services/api/dream-media";
import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { DREAM_API_MODELS, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = { signal?: AbortSignal };
type DreamApiEnvelope<T = unknown> = { code?: number; message?: string; msg?: string; data?: T | null; error?: { message?: string } };
export type DreamVideoTaskState = { status: "pending" } | { status: "completed"; url: string } | { status: "failed"; error: Error };
type DreamTaskState = { status: "pending" } | { status: "completed"; results: unknown } | { status: "failed"; error: Error };

const DREAM_TASK_POLL_INTERVAL_MS = 1500;
const DREAM_VIDEO_CHUNK_SIZE = 5 * 1024 * 1024;

export function fetchDreamModels() {
    return [...DREAM_API_MODELS].sort((a, b) => a.localeCompare(b));
}

export async function requestDreamImageGeneration(config: AiConfig, prompt: string, count: number, options?: RequestOptions) {
    const { width, height } = resolveDreamImageDimensions(config.size, config.quality);
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/dream_image"),
        {
            project_id: 0,
            dream_image_req_key: modelOptionName(config.model),
            script_text: prompt,
            width,
            height,
            num_images: count,
            platform_id: config.platformId,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    const taskId = dreamTaskId(response.data);
    return taskId ? pollDreamImageTask(config, taskId, options) : dreamImagesFromPayload(response.data, config.baseUrl);
}

export async function requestDreamImageEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, count = 1, options?: RequestOptions) {
    if (mask) return requestDreamInpainting(config, prompt, references, mask, options);
    if (modelOptionName(config.model).toLowerCase().includes("outpainting")) return requestDreamOutpainting(config, prompt, references, options);
    const { width, height } = resolveDreamImageDimensions(config.size, config.quality);
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/dream_image"),
        {
            project_id: 0,
            dream_image_req_key: modelOptionName(config.model),
            image_asset_ids: await dreamImageAssetIds(config, references, options),
            script_text: prompt,
            width,
            height,
            num_images: count,
            platform_id: config.platformId,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    const taskId = dreamTaskId(response.data);
    return taskId ? pollDreamImageTask(config, taskId, options) : dreamImagesFromPayload(response.data, config.baseUrl);
}

export async function requestDreamVideoTask(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions) {
    const model = modelOptionName(config.model);
    try {
        const body = await dreamVideoRequestBody(config, model, prompt, references, videoReferences, audioReferences, options);
        const response = await axios.post<DreamApiEnvelope>(dreamApiUrl(config, "/api/v1/dream/dream_video"), body, { headers: dreamHeaders(config), signal: options?.signal });
        return dreamTaskId(response.data) || firstDreamVideoUrl(response.data, config.baseUrl, "error.dream.videoTaskMissing");
    } catch (error) {
        throw readDreamRequestError(error, "error.dream.videoTaskCreateFailed");
    }
}

export async function pollDreamVideoTask(config: AiConfig, taskId: string, options?: RequestOptions): Promise<DreamVideoTaskState> {
    if (isDreamMediaReference(taskId)) {
        return { status: "completed", url: absoluteDreamUrl(config.baseUrl, taskId) };
    }
    const state = await requestDreamTaskState(config, taskId, options);
    if (state.status !== "completed") return state;
    return {
        status: "completed",
        url: firstDreamVideoUrl(state.results, config.baseUrl, "error.dream.videoResultMissing"),
    };
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
            platform_id: config.platformId,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    const url = firstDreamAudioUrl(response.data, config.baseUrl, "error.dream.audioResultMissing");
    const blob = await requestDreamMediaBlob(config, url, options);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(config.audioFormat) });
}

function dreamApiUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    let url = `${baseUrl}${path}`;
    if (baseUrl.toLowerCase().endsWith("/api/v1") && path.startsWith("/api/v1/")) url = `${baseUrl}${path.slice("/api/v1".length)}`;
    else if (baseUrl.toLowerCase().endsWith("/api") && path.startsWith("/api/")) url = `${baseUrl}${path.slice("/api".length)}`;
    return dreamApiProxyUrl(url, baseUrl, dreamProxyEnabled());
}

function dreamHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "Content-Type": "application/json",
        ...dreamAuthHeaders(config),
    };
}

function dreamAuthHeaders(config: Pick<AiConfig, "apiKey">) {
    const apiKey = config.apiKey.trim();
    if (!apiKey) throw new AppError("error.dream.authRequired");
    return { Authorization: `Bearer ${apiKey}` };
}

async function requestDreamInpainting(config: AiConfig, prompt: string, references: ReferenceImage[], mask: ReferenceImage, options?: RequestOptions) {
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/inpainting_edit"),
        {
            project_id: 0,
            req_key: modelOptionName(config.model) || "i2i_inpainting_edit",
            task_type: "dream",
            image_asset_ids: await dreamImageAssetIds(config, [...references, mask], options),
            script_text: prompt,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    const taskId = dreamTaskId(response.data);
    return taskId ? pollDreamImageTask(config, taskId, options) : dreamImagesFromPayload(response.data, config.baseUrl);
}

async function requestDreamOutpainting(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const response = await axios.post<DreamApiEnvelope>(
        dreamApiUrl(config, "/api/v1/dream/outpainting"),
        {
            project_id: 0,
            req_key: modelOptionName(config.model) || "i2i_outpainting",
            task_type: "dream",
            image_asset_ids: await dreamImageAssetIds(config, references, options),
            script_text: prompt || null,
            top: 0.1,
            bottom: 0.1,
            left: 0.1,
            right: 0.1,
        },
        { headers: dreamHeaders(config), signal: options?.signal },
    );
    const taskId = dreamTaskId(response.data);
    return taskId ? pollDreamImageTask(config, taskId, options) : dreamImagesFromPayload(response.data, config.baseUrl);
}

function dreamImagesFromPayload(payload: unknown, baseUrl: string) {
    const urls = dreamUrls(payload, baseUrl);
    if (!urls.length) throw new AppError("error.dream.imageResultMissing");
    return urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

async function pollDreamImageTask(config: AiConfig, taskId: string, options?: RequestOptions) {
    const deadline = Date.now() + ENV_AI_TASK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const state = await requestDreamTaskState(config, taskId, options);
        if (state.status === "failed") throw state.error;
        if (state.status === "completed") return dreamImagesFromPayload(state.results, config.baseUrl);
        await dreamDelay(DREAM_TASK_POLL_INTERVAL_MS, options?.signal);
    }
    throw new AppError("error.dream.imageTimeout");
}

async function requestDreamTaskState(config: AiConfig, taskId: string, options?: RequestOptions): Promise<DreamTaskState> {
    const encodedTaskId = encodeURIComponent(taskId);
    const statusResponse = await axios.get<DreamApiEnvelope>(dreamApiUrl(config, `/api/v1/task/${encodedTaskId}/status`), {
        headers: dreamHeaders(config),
        signal: options?.signal,
    });
    const status = unwrapDreamPayload(statusResponse.data);
    if (dreamTaskFailed(status)) {
        return { status: "failed", error: await dreamTaskFailureError(config, encodedTaskId, status, options) };
    }
    if (!dreamTaskDone(status)) return { status: "pending" };
    const resultsResponse = await axios.get<DreamApiEnvelope>(dreamApiUrl(config, `/api/v1/task/${encodedTaskId}/results`), {
        headers: dreamHeaders(config),
        signal: options?.signal,
    });
    return { status: "completed", results: resultsResponse.data };
}

async function dreamTaskFailureError(config: AiConfig, encodedTaskId: string, status: unknown, options?: RequestOptions) {
    const fallback = dreamTaskError(status, "");
    try {
        const detailResponse = await axios.get<DreamApiEnvelope>(dreamApiUrl(config, `/api/v1/task/${encodedTaskId}`), {
            headers: dreamHeaders(config),
            signal: options?.signal,
        });
        const rawMessage = dreamTaskError(unwrapDreamPayload(detailResponse.data), fallback);
        return rawMessage ? new AppError("error.dream.taskFailed", undefined, { rawMessage }) : new AppError("error.dream.taskFailed");
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        return fallback ? new AppError("error.dream.taskFailed", undefined, { rawMessage: fallback }) : new AppError("error.dream.taskFailed");
    }
}

function dreamTaskId(payload: unknown): string {
    const data = unwrapDreamPayload(payload);
    if (typeof data === "string") {
        const value = data.trim();
        if (!value || isDreamMediaReference(value)) return "";
        const parsed = parseJson(value);
        return parsed === value ? value : dreamTaskId(parsed);
    }
    if (!isRecord(data)) return "";
    return stringValue(data.task_id || data.taskId).trim();
}

function dreamTaskDone(value: unknown) {
    if (!isRecord(value)) return false;
    const status = stringValue(value.status).toLowerCase();
    return value.done === true || status === "success" || status === "completed";
}

function dreamTaskFailed(value: unknown) {
    if (!isRecord(value)) return false;
    const status = stringValue(value.status).toLowerCase();
    return value.failed === true || status === "failed" || status === "error" || status === "cancel" || status === "cancelled";
}

function dreamTaskError(value: unknown, fallback: string) {
    if (!isRecord(value)) return fallback;
    return stringValue(value.error_message) || stringValue(value.message) || stringValue(value.error) || fallback;
}

function firstDreamVideoUrl(payload: unknown, baseUrl: string, fallback: I18nKey) {
    return firstDreamUrlForKeys(payload, baseUrl, ["video_url", "videoUrl", "url", "file_url", "fileUrl", "file_path", "filePath"], fallback);
}

function firstDreamAudioUrl(payload: unknown, baseUrl: string, fallback: I18nKey) {
    return firstDreamUrlForKeys(payload, baseUrl, ["audio_url", "audioUrl", "url", "file_url", "fileUrl", "file_path", "filePath"], fallback);
}

function firstDreamUrlForKeys(payload: unknown, baseUrl: string, keys: string[], fallback: I18nKey) {
    const value = unwrapDreamPayload(payload);
    const url = collectDreamStringsForKeys(value, keys)[0];
    if (!url) throw new AppError(fallback);
    return absoluteDreamUrl(baseUrl, url);
}

function dreamUrls(payload: unknown, baseUrl: string) {
    const data = unwrapDreamPayload(payload);
    const urls = collectDreamPreferredStrings(data, ["file_url", "fileUrl", "image_url", "imageUrl", "file_path", "filePath", "url", "video_url", "videoUrl", "thumbnail_url", "thumbnailUrl", "dataUrl"]);
    return Array.from(new Set(urls.map((url) => absoluteDreamUrl(baseUrl, url))));
}

function unwrapDreamPayload(payload: unknown): unknown {
    if (!isRecord(payload)) return payload;
    if (typeof payload.code === "number" && payload.code !== 0) {
        const rawMessage = stringValue(payload.message) || stringValue(payload.msg);
        throw rawMessage ? new AppError("error.dream.requestFailed", undefined, { rawMessage }) : requestError(undefined, "error.dream.requestFailed");
    }
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
    const keys = [
        "url",
        "image_url",
        "imageUrl",
        "file_url",
        "fileUrl",
        "file_path",
        "filePath",
        "thumbnail_url",
        "thumbnailUrl",
        "audio_url",
        "audioUrl",
        "video_url",
        "videoUrl",
        "dataUrl",
        "result",
        "output",
        "data",
        "images",
        "audios",
        "videos",
        "urls",
        "files",
    ];
    return keys.flatMap((key) => collectDreamStrings(value[key]));
}

function collectDreamStringsForKeys(value: unknown, keys: string[]): string[] {
    if (!value) return [];
    if (typeof value === "string") return collectDreamStrings(value);
    if (Array.isArray(value)) return value.flatMap((item) => collectDreamStringsForKeys(item, keys));
    if (!isRecord(value)) return [];
    const direct = keys.flatMap((key) => collectDreamStrings(value[key]));
    if (direct.length) return direct;
    return ["data", "result", "output", "results", "files", "videos", "audios"].flatMap((key) => collectDreamStringsForKeys(value[key], keys));
}

function collectDreamPreferredStrings(value: unknown, keys: string[]): string[] {
    if (!value) return [];
    if (typeof value === "string") return collectDreamStrings(value);
    if (Array.isArray(value)) return value.flatMap((item) => collectDreamPreferredStrings(item, keys));
    if (!isRecord(value)) return [];
    for (const key of keys) {
        const direct = collectDreamStrings(value[key]);
        if (direct.length) return direct;
    }
    return ["data", "result", "output", "results", "images", "files", "videos", "urls"].flatMap((key) => collectDreamPreferredStrings(value[key], keys));
}

function isDreamMediaReference(value: string) {
    return /^(https?:|data:|blob:|asset:\/\/|\/)/i.test(value) || /\.(?:avif|gif|jpe?g|png|webp|m4a|mp3|ogg|wav|webm|mov|mp4)(?:[?#].*)?$/i.test(value);
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
    let absoluteUrl = value;
    if (!/^(https?:|data:|blob:|asset:\/\/)/i.test(value)) {
        const base = baseUrl.trim();
        if (base) {
            try {
                absoluteUrl = new URL(value, base.endsWith("/") ? base : `${base}/`).toString();
            } catch {
                absoluteUrl = value;
            }
        }
    }
    const proxyEnabled = dreamProxyEnabled();
    return dreamMediaProxyUrl(dreamApiProxyUrl(absoluteUrl, baseUrl, proxyEnabled), proxyEnabled);
}

async function dreamImageAssetIds(config: AiConfig, images: ReferenceImage[], options?: RequestOptions) {
    const ids = await Promise.all(images.map((image) => uploadDreamImageAsset(config, image, options)));
    return optionalList(ids);
}

async function dreamVideoRequestBody(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions) {
    const scriptText = prompt.trim();
    if (!scriptText) throw new AppError("video.promptRequired");
    if (config.videoMode === "subject" && !isDreamSeedance20Model(model)) throw dreamError("error.dream.subjectModelRequired");
    const mode = normalizeDreamVideoMode(config.videoMode, model);
    const body: Record<string, unknown> = {
        platform_id: config.platformId,
        project_id: 0,
        // Seedance 2.0's omni-reference mode uses reference2video while its
        // uploaded image, video, and audio assets remain flat ID lists.
        action_type: mode === "subject" ? "reference2video" : "start-end2video",
        dream_video_req_key: model,
        script_text: scriptText,
        aspect_ratio: normalizeDreamVideoRatio(config.size, model),
        duration: normalizeDreamVideoDuration(config.videoSeconds, model),
        audio: boolConfig(config.videoGenerateAudio, false),
    };
    if (isDreamSeedance15Model(model)) {
        body.seed = normalizeDreamVideoSeed(config.videoSeed);
    }
    if (mode === "start-end") {
        const orderedReferences = dreamStartEndReferences(references);
        if (videoReferences.length || audioReferences.length) throw dreamError("error.dream.startEndReferencesOnly");
        body.image_asset_ids = await dreamImageAssetIds(config, orderedReferences, options);
        return body;
    }
    if (!isDreamSeedance20Model(model)) throw dreamError("error.dream.subjectModelRequired");
    const referenceIssue = dreamOmniReferenceIssue(references, videoReferences, audioReferences);
    if (referenceIssue) throw dreamError(referenceIssue.key);
    body.image_asset_ids = await dreamImageAssetIds(config, references, options);
    body.video_ids = await dreamVideoAssetIds(config, videoReferences, options);
    body.audio_ids = await dreamAudioAssetIds(config, audioReferences, options);
    return body;
}

function dreamStartEndReferences(references: ReferenceImage[]) {
    if (references.length !== 2) throw dreamError("error.dream.startEndImagesRequired");
    const hasRoles = references.some((image) => image.videoRole === "first" || image.videoRole === "last");
    if (!hasRoles) return references;
    const first = references.filter((image) => image.videoRole === "first");
    const last = references.filter((image) => image.videoRole === "last");
    if (first.length !== 1 || last.length !== 1) throw dreamError("error.dream.startEndImagesRequired");
    return [first[0]!, last[0]!];
}

async function uploadDreamImageAsset(config: AiConfig, image: ReferenceImage, options?: RequestOptions) {
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new AppError("error.dream.mediaReadFailed");
    const formData = new FormData();
    formData.set("file", dataUrlToFile({ ...image, dataUrl }));
    formData.set("usage", "mixcut");
    const response = await axios.post(dreamApiUrl(config, "/api/v1/upload/upload/image"), formData, {
        headers: dreamAuthHeaders(config),
        signal: options?.signal,
    });
    const asset = unwrapDreamPayload(response.data);
    const id = typeof asset === "string" ? asset.trim() : isRecord(asset) ? stringValue(asset.id || asset.asset_id || asset.assetId).trim() : "";
    if (!id) throw new AppError("error.dream.imageUploadResultMissing");
    return id;
}

async function dreamAudioAssetIds(config: AiConfig, items: ReferenceAudio[], options?: RequestOptions) {
    const ids = await Promise.all(items.map((item) => uploadDreamAudioAsset(config, item, options)));
    return optionalList(ids);
}

async function uploadDreamAudioAsset(config: AiConfig, audio: ReferenceAudio, options?: RequestOptions) {
    const blob = await dreamMediaBlob(config, audio, options);
    const formData = new FormData();
    formData.set("file", dreamMediaFile(blob, audio.name || "audio"));
    formData.set("usage", "mixcut");
    const response = await axios.post(dreamApiUrl(config, "/api/v1/upload/upload/audio"), formData, {
        headers: dreamAuthHeaders(config),
        signal: options?.signal,
    });
    return dreamAssetId(response.data, "error.dream.audioUploadResultMissing");
}

async function dreamVideoAssetIds(config: AiConfig, items: ReferenceVideo[], options?: RequestOptions) {
    const ids = await Promise.all(items.map((item) => uploadDreamVideoAsset(config, item, options)));
    return optionalList(ids);
}

async function uploadDreamVideoAsset(config: AiConfig, video: ReferenceVideo, options?: RequestOptions) {
    const blob = await dreamMediaBlob(config, video, options);
    const uploadId = nanoid();
    const totalChunks = Math.max(1, Math.ceil(blob.size / DREAM_VIDEO_CHUNK_SIZE));
    for (let index = 0; index < totalChunks; index += 1) {
        const formData = new FormData();
        formData.set("upload_id", uploadId);
        formData.set("chunk_index", String(index));
        formData.set("file", dreamMediaFile(blob.slice(index * DREAM_VIDEO_CHUNK_SIZE, Math.min(blob.size, (index + 1) * DREAM_VIDEO_CHUNK_SIZE), blob.type), video.name || "video"));
        await axios.post(dreamApiUrl(config, "/api/v1/upload/upload/chunk"), formData, {
            headers: dreamAuthHeaders(config),
            signal: options?.signal,
        });
    }
    const finalizeBody = new FormData();
    finalizeBody.set("upload_id", uploadId);
    finalizeBody.set("total_chunks", String(totalChunks));
    finalizeBody.set("file_ext", dreamFileExt(video.name, blob.type, "mp4"));
    finalizeBody.set("usage", "mixcut");
    const response = await axios.post(dreamApiUrl(config, "/api/v1/upload/upload/video"), finalizeBody, {
        headers: dreamAuthHeaders(config),
        signal: options?.signal,
    });
    const id = dreamAssetId(response.data, "");
    if (id) return id;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const status = await axios.get<DreamApiEnvelope>(dreamApiUrl(config, `/api/v1/upload/upload/status?upload_id=${encodeURIComponent(uploadId)}`), {
            headers: dreamAuthHeaders(config),
            signal: options?.signal,
        });
        const uploadedId = dreamAssetId(status.data, "");
        if (uploadedId) return uploadedId;
        if (attempt < 4) await dreamDelay(500, options?.signal);
    }
    throw dreamError("error.dream.videoUploadResultMissing");
}

async function dreamMediaBlob(config: AiConfig, item: ReferenceVideo | ReferenceAudio, options?: RequestOptions) {
    if (item.storageKey) {
        const blob = await getMediaBlob(item.storageKey);
        if (blob) return blob;
    }
    if (item.url) return requestDreamMediaBlob(config, item.url, options);
    throw new AppError("error.dream.mediaReadFailed");
}

function dreamMediaFile(blob: Blob, name: string) {
    return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

function dreamAssetId(payload: unknown, fallback: I18nKey | "") {
    const asset = unwrapDreamPayload(payload);
    const id = typeof asset === "string" ? asset.trim() : isRecord(asset) ? stringValue(asset.id || asset.asset_id || asset.assetId || (isRecord(asset.asset) ? asset.asset.id || asset.asset.asset_id || asset.asset.assetId : "")).trim() : "";
    if (!id && fallback) throw dreamError(fallback);
    return id;
}

function dreamError(key: I18nKey) {
    return new AppError(key);
}

function optionalList(values: Array<string | null | undefined>) {
    const list = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    return list.length ? list : undefined;
}

function dreamFileExt(name: string, mimeType: string, fallback: string) {
    const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (match?.[1]) return match[1];
    if (mimeType.includes("/")) {
        const subtype = mimeType.split("/").pop();
        if (subtype === "quicktime") return "mov";
        if (subtype === "mpeg") return "mp3";
        return subtype || fallback;
    }
    return fallback;
}

function isDreamSeedance15Model(model: string) {
    return modelOptionName(model) === DREAM_SEEDANCE_15_MODEL;
}

function isDreamSeedance20Model(model: string) {
    return modelOptionName(model) === DREAM_SEEDANCE_20_MODEL;
}

function boolConfig(value: string, fallback: boolean) {
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

function readDreamRequestError(error: unknown, fallback: I18nKey) {
    if (error instanceof AppError) return error;
    if (axios.isCancel(error)) return new AppError("error.requestCancelled");
    if (axios.isAxiosError<{ detail?: unknown; message?: string; msg?: string }>(error)) {
        const data = error.response?.data;
        const rawMessage = dreamValidationDetail(data?.detail) || data?.message || data?.msg;
        return requestError(error.response?.status, fallback, rawMessage);
    }
    if (error instanceof DOMException && error.name === "AbortError") return new AppError("error.requestCancelled");
    return error instanceof Error ? error : requestError(undefined, fallback);
}

function dreamValidationDetail(detail: unknown) {
    if (typeof detail === "string") return detail;
    if (!Array.isArray(detail)) return "";
    return detail
        .map((item) => {
            if (!isRecord(item)) return "";
            const location = Array.isArray(item.loc)
                ? item.loc
                      .map(String)
                      .filter((part) => part !== "body")
                      .join(".")
                : "";
            const message = stringValue(item.msg);
            return location && message ? `${location}: ${message}` : message;
        })
        .filter(Boolean)
        .join("；");
}

function dreamDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason || new DOMException("Aborted", "AbortError"));
            return;
        }
        const onAbort = () => {
            globalThis.clearTimeout(timer);
            reject(signal?.reason || new DOMException("Aborted", "AbortError"));
        };
        const timer = globalThis.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function requestDreamMediaBlob(config: AiConfig, url: string, options?: RequestOptions) {
    if (url.startsWith("data:") || url.startsWith("blob:")) return fetch(url, { signal: options?.signal }).then((response) => response.blob());
    const response = await axios.get<Blob>(url, {
        headers: dreamMediaHeaders(config, url),
        responseType: "blob",
        signal: options?.signal,
    });
    return response.data;
}

function dreamMediaHeaders(config: Pick<AiConfig, "apiKey" | "baseUrl">, url: string) {
    if (url.startsWith(DREAM_API_PROXY_PATH)) return { Authorization: `Bearer ${config.apiKey.trim()}` };
    try {
        if (new URL(url).origin !== new URL(config.baseUrl).origin) return undefined;
    } catch {
        return undefined;
    }
    return { Authorization: `Bearer ${config.apiKey.trim()}` };
}

function dreamProxyEnabled() {
    return typeof window !== "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}
