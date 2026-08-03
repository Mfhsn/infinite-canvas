import { normalizeDreamImageResolution, resolveDreamImageDimensions } from "@/lib/dream-image-size";
import { boolConfig, isDreamSeedanceModel, normalizeDreamVideoDuration } from "@/lib/seedance-video";
import { DREAM_IMAGE_MODELS, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type DreamPointsEstimateRequest = {
    req_key: string;
    platform_id: number;
    count: number;
    audio_flag?: boolean;
    duration?: number;
    has_input?: boolean;
    ref_image_count?: number;
    image_quality?: "low" | "medium" | "high";
    size?: string;
    width?: number;
    height?: number;
};

export type DreamPointsEstimateSpec = {
    config: AiConfig;
    request: DreamPointsEstimateRequest;
};

export function buildDreamImagePointsSpec(config: AiConfig, count: string | number, referenceImageCount: number): DreamPointsEstimateSpec | null {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const model = modelOptionName(requestConfig.model);
    if (requestConfig.apiFormat !== "dream" || !DREAM_IMAGE_MODELS.includes(model as (typeof DREAM_IMAGE_MODELS)[number])) return null;
    const { width, height } = resolveDreamImageDimensions(requestConfig.size, requestConfig.quality);
    const resolution = normalizeDreamImageResolution(requestConfig.quality);
    return {
        config: requestConfig,
        request: {
            req_key: model,
            platform_id: requestConfig.platformId,
            count: boundedInteger(count, 1, 1000, 1),
            ref_image_count: boundedInteger(referenceImageCount, 0, 100, 0),
            image_quality: resolution === "4k" ? "high" : "medium",
            size: `${width}x${height}`,
            width,
            height,
        },
    };
}

export function buildDreamVideoPointsSpec(config: AiConfig, references: { imageCount: number; videoCount: number }): DreamPointsEstimateSpec | null {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const model = modelOptionName(requestConfig.model);
    if (requestConfig.apiFormat !== "dream" || !isDreamSeedanceModel(model)) return null;
    return {
        config: requestConfig,
        request: {
            req_key: model,
            platform_id: requestConfig.platformId,
            count: 1,
            duration: normalizeDreamVideoDuration(requestConfig.videoSeconds, model),
            audio_flag: boolConfig(requestConfig.videoGenerateAudio, false),
            has_input: references.imageCount > 0 || references.videoCount > 0,
        },
    };
}

function boundedInteger(value: string | number, min: number, max: number, fallback: number) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
