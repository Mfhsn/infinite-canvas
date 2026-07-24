import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { I18nKey, I18nParams } from "@/i18n/messages";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export const SEEDANCE_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    audios: 3,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
};

export const DREAM_SEEDANCE_15_MODEL = "doubao-seedance-1-5-pro-251215";
export const DREAM_SEEDANCE_20_MODEL = "doubao-seedance-2-0-260128";
export type DreamVideoMode = "start-end" | "subject";

export const seedanceResolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
] as const;

export const seedanceRatioOptions = [
    { value: "16:9", label: "Landscape" },
    { value: "9:16", label: "Portrait" },
    { value: "1:1", label: "Square" },
    { value: "4:3", label: "Standard landscape" },
    { value: "3:4", label: "Standard portrait" },
    { value: "21:9", label: "Cinema" },
    { value: "adaptive", label: "Adaptive" },
] as const;

export const seedanceDurationOptions = [-1, 4, 5, 6, 8, 10, 12, 15] as const;

export function isBuiltInDreamVideoConfig(config: AiConfig) {
    const selectedModel = config.videoModel || config.model;
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    return requestConfig.apiFormat === "dream" && isDreamSeedanceModel(modelOptionName(requestConfig.videoModel || requestConfig.model || selectedModel));
}

export function isDreamSeedanceModel(model: string) {
    return model === DREAM_SEEDANCE_15_MODEL || model === DREAM_SEEDANCE_20_MODEL;
}

export function isDreamSeedance20Model(model: string) {
    return model === DREAM_SEEDANCE_20_MODEL;
}

export function dreamVideoModes(model: string): DreamVideoMode[] {
    return isDreamSeedance20Model(model) ? ["start-end", "subject"] : ["start-end"];
}

export function defaultDreamVideoMode(model: string): DreamVideoMode {
    return isDreamSeedance20Model(model) ? "subject" : "start-end";
}

export function normalizeDreamVideoMode(value: string, model: string): DreamVideoMode {
    return value === "subject" && isDreamSeedance20Model(model) ? "subject" : "start-end";
}

export function dreamVideoRatioOptions(model: string) {
    return seedanceRatioOptions.filter((item) => item.value !== "adaptive" && (item.value !== "21:9" || isDreamSeedance20Model(model)));
}

export function normalizeDreamVideoRatio(value: string, model: string) {
    const ratio = normalizeSeedanceRatio(value);
    return dreamVideoRatioOptions(model).some((item) => item.value === ratio) ? ratio : "16:9";
}

export function normalizeDreamVideoDuration(value: string, model: string) {
    const seconds = Math.floor(Number(value) || (isDreamSeedance20Model(model) ? 10 : 5));
    if (isDreamSeedance20Model(model)) return Math.max(4, Math.min(15, seconds));
    return seconds > 5 ? 10 : 5;
}

export function normalizeDreamVideoSeed(value: string) {
    const normalized = value.trim();
    if (!normalized) return -1;
    const seed = Number(normalized);
    return Number.isInteger(seed) ? seed : -1;
}

const seedancePixels = {
    "480p": {
        "16:9": "864x496",
        "4:3": "752x560",
        "1:1": "640x640",
        "3:4": "560x752",
        "9:16": "496x864",
        "21:9": "992x432",
    },
    "720p": {
        "16:9": "1280x720",
        "4:3": "1112x834",
        "1:1": "960x960",
        "3:4": "834x1112",
        "9:16": "720x1280",
        "21:9": "1470x630",
    },
    "1080p": {
        "16:9": "1920x1080",
        "4:3": "1664x1248",
        "1:1": "1440x1440",
        "3:4": "1248x1664",
        "9:16": "1080x1920",
        "21:9": "2206x946",
    },
} as const;

export function isSeedanceVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "baseUrl">) {
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
    return isSeedanceVideoModel(modelOptionName(requestConfig.model || requestConfig.videoModel)) || isArkPlanBaseUrl(requestConfig.baseUrl);
}

export function isSeedanceVideoModel(model: string) {
    const value = model.toLowerCase();
    return value.includes("seedance") || value.includes("doubao-seedance");
}

export function isSeedanceFastModel(model: string) {
    const value = model.toLowerCase();
    return isSeedanceVideoModel(value) && value.includes("fast");
}

export function isArkPlanBaseUrl(baseUrl: string) {
    return baseUrl.toLowerCase().includes("ark.cn-beijing.volces.com/api/plan/v3") || baseUrl.toLowerCase().includes("/api/plan/v3");
}

export function normalizeSeedanceResolution(value: string, model = "") {
    const normalized = normalizeResolutionToken(value);
    if (isSeedanceFastModel(model) && normalized === "1080p") return "720p";
    return seedanceResolutionOptions.some((item) => item.value === normalized) ? normalized : "720p";
}

export function normalizeResolutionToken(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = String(value || "").replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

export function normalizeSeedanceDuration(value: string) {
    if (String(value).trim() === "-1") return -1;
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

export function normalizeSeedanceRatio(value: string) {
    if (!value || value === "auto" || value === "adaptive") return "adaptive";
    if (seedanceRatioOptions.some((item) => item.value === value)) return value;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return "adaptive";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "adaptive";
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["4:3", 4 / 3],
        ["1:1", 1],
        ["3:4", 3 / 4],
        ["9:16", 9 / 16],
        ["21:9", 21 / 9],
    ] as const;
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

export function seedancePixelLabel(resolution: string, ratio: string) {
    const normalizedResolution = normalizeSeedanceResolution(resolution) as keyof typeof seedancePixels;
    const normalizedRatio = normalizeSeedanceRatio(ratio) as keyof (typeof seedancePixels)[typeof normalizedResolution] | "adaptive";
    if (normalizedRatio === "adaptive") return "auto";
    return seedancePixels[normalizedResolution][normalizedRatio] || "";
}

export function boolConfig(value: string | undefined, fallback: boolean) {
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

export function seedanceReferenceLabel(kind: "image" | "video" | "audio", index: number) {
    if (kind === "image") return `图片${index + 1}`;
    if (kind === "video") return `视频${index + 1}`;
    return `音频${index + 1}`;
}

export function buildSeedancePromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    const labels = [...images.map((_, index) => seedanceReferenceLabel("image", index)), ...videos.map((_, index) => seedanceReferenceLabel("video", index)), ...audios.map((_, index) => seedanceReferenceLabel("audio", index))];
    const text = prompt.trim();
    if (!labels.length) return text;
    return `参考素材编号：${labels.join("、")}。请按这些编号理解提示词中的图片、视频和音频引用。\n\n${text}`;
}

export function ensureSeedanceReferenceMentions(prompt: string, images: readonly unknown[], videos: readonly unknown[], audios: readonly unknown[]) {
    const labels = [...images.map((_, index) => `@${seedanceReferenceLabel("image", index)}`), ...videos.map((_, index) => `@${seedanceReferenceLabel("video", index)}`), ...audios.map((_, index) => `@${seedanceReferenceLabel("audio", index)}`)];
    const text = prompt.trim();
    if (!labels.length || labels.some((label) => text.includes(label))) return text;
    return `${text}\n\n${labels.join(" ")}`;
}

export type SeedanceVideoReferenceIssue = { key: I18nKey; params?: I18nParams };

export function dreamOmniReferenceIssue(images: readonly unknown[], videos: readonly unknown[], audios: readonly unknown[]): SeedanceVideoReferenceIssue | null {
    if (!images.length && !videos.length && !audios.length) return { key: "error.dream.subjectReferencesRequired" };
    if (images.length > SEEDANCE_REFERENCE_LIMITS.images) return { key: "error.dream.imageReferenceLimit" };
    if (videos.length > SEEDANCE_REFERENCE_LIMITS.videos) return { key: "error.dream.videoReferenceLimit" };
    if (audios.length > SEEDANCE_REFERENCE_LIMITS.audios) return { key: "error.dream.audioReferenceLimit" };
    return null;
}

export function seedanceVideoReferenceError(videos: ReferenceVideo[]): SeedanceVideoReferenceIssue | null {
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const params = { index: index + 1 };
        if (video.bytes && video.bytes > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes) return { key: "video.referenceIssue.tooLarge", params };
        if (video.durationMs) {
            if (video.durationMs < 2000 || video.durationMs > 15000) return { key: "video.referenceIssue.duration", params };
            totalDurationMs += video.durationMs;
        }
        if (video.width && video.height) {
            if (video.width < 300 || video.width > 6000 || video.height < 300 || video.height > 6000) return { key: "video.referenceIssue.dimensions", params };
            const ratio = video.width / video.height;
            if (ratio < 0.4 || ratio > 2.5) return { key: "video.referenceIssue.ratio", params };
            const pixels = video.width * video.height;
            if (pixels < 640 * 640 || pixels > 2206 * 946) return { key: "video.referenceIssue.pixels", params };
        }
    }
    if (totalDurationMs > 15000) return { key: "video.referenceIssue.totalDuration" };
    return null;
}
