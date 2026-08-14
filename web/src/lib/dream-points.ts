import { dreamImageResolutionsForModel, isDreamGptImageModel, normalizeDreamImageQuality, normalizeDreamImageResolution, resolveDreamImageDimensions } from "@/lib/dream-image-size";
import { boolConfig, isDreamSeedance20Model, isDreamSeedanceModel, normalizeDreamVideoDuration, normalizeDreamVideoResolution, type DreamVideoResolution } from "@/lib/seedance-video";
import { DREAM_IMAGE_MODELS, DREAM_TEXT_MODELS, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { dreamImagePlatformId, dreamVideoPlatformId, ENV_AI_LLM_MAX_COMPLETION_TOKENS, ENV_AI_PLATFORM_ID } from "@/constant/env";

export type DreamPointsEstimateRequest = {
    req_key: string;
    platform_id: number;
    count: number;
    audio_flag?: boolean;
    completion_tokens?: number;
    duration?: number;
    has_input?: boolean;
    ref_image_count?: number;
    image_quality?: "low" | "medium" | "high";
    resolution?: DreamVideoResolution;
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
    const { width, height } = resolveDreamImageDimensions(requestConfig.size, requestConfig.quality, model);
    const resolution = normalizeDreamImageResolution(requestConfig.quality, dreamImageResolutionsForModel(model));
    return {
        config: requestConfig,
        request: {
            req_key: model,
            platform_id: dreamImagePlatformId(),
            count: boundedInteger(count, 1, 1000, 1),
            ref_image_count: boundedInteger(referenceImageCount, 0, 100, 0),
            image_quality: isDreamGptImageModel(model) ? normalizeDreamImageQuality(requestConfig.imageQuality) : resolution === "4k" ? "high" : resolution === "1k" ? "low" : "medium",
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
            platform_id: dreamVideoPlatformId(),
            count: 1,
            duration: normalizeDreamVideoDuration(requestConfig.videoSeconds, model),
            audio_flag: boolConfig(requestConfig.videoGenerateAudio, false),
            has_input: references.imageCount > 0 || references.videoCount > 0,
            ...(isDreamSeedance20Model(model) ? { resolution: normalizeDreamVideoResolution(requestConfig.vquality, model) } : {}),
        },
    };
}

export function buildDreamTextPointsSpec(config: AiConfig, count: string | number): DreamPointsEstimateSpec | null {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    const model = modelOptionName(requestConfig.model);
    if (requestConfig.apiFormat !== "dream" || !DREAM_TEXT_MODELS.includes(model as (typeof DREAM_TEXT_MODELS)[number])) return null;
    return {
        config: requestConfig,
        request: {
            req_key: model,
            platform_id: ENV_AI_PLATFORM_ID,
            count: boundedInteger(count, 1, 1000, 1),
            completion_tokens: ENV_AI_LLM_MAX_COMPLETION_TOKENS,
        },
    };
}

function boundedInteger(value: string | number, min: number, max: number, fallback: number) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
