import { AppError } from "@/lib/app-error";

export const DREAM_IMAGE_RESOLUTIONS = ["2k", "4k"] as const;
export const DREAM_IMAGE_ALL_RESOLUTIONS = ["1k", ...DREAM_IMAGE_RESOLUTIONS] as const;
export const DREAM_IMAGE_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"] as const;
export const DREAM_GBI_IMAGE_RESOLUTIONS = ["1k", "2k", "4k"] as const;
export const DREAM_GBI_IMAGE_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export const DREAM_GPT_IMAGE_RESOLUTIONS = ["1k", "2k"] as const;
export const DREAM_GPT_IMAGE_1K_RATIOS = ["1:1"] as const;
export const DREAM_GPT_IMAGE_2K_RATIOS = ["16:9"] as const;
export const DREAM_GPT_IMAGE_RATIOS = ["1:1", "16:9"] as const;
export const DREAM_IMAGE_QUALITY_VALUES = ["low", "medium", "high"] as const;

export type DreamImageResolution = (typeof DREAM_IMAGE_ALL_RESOLUTIONS)[number];
export type DreamImageRatio = (typeof DREAM_IMAGE_RATIOS)[number];
export type DreamImageQuality = (typeof DREAM_IMAGE_QUALITY_VALUES)[number];

const DREAM_IMAGE_MIN_PIXELS = 3_686_400;
const DREAM_IMAGE_MAX_PIXELS = 16_777_216;
const DREAM_IMAGE_SIZE_STEP = 16;

const DREAM_IMAGE_2K_DIMENSIONS: Record<DreamImageRatio, readonly [number, number]> = {
    "1:1": [2048, 2048],
    "4:3": [2304, 1728],
    "3:4": [1728, 2304],
    "3:2": [2496, 1664],
    "2:3": [1664, 2496],
    "16:9": [2560, 1440],
    "9:16": [1440, 2560],
    "21:9": [3024, 1296],
    "9:21": [1296, 3024],
};
const DREAM_IMAGE_1K_DIMENSIONS: Record<DreamImageRatio, readonly [number, number]> = {
    "1:1": [1024, 1024],
    "4:3": [1152, 864],
    "3:4": [864, 1152],
    "3:2": [1248, 832],
    "2:3": [832, 1248],
    "16:9": [1280, 720],
    "9:16": [720, 1280],
    "21:9": [1344, 576],
    "9:21": [576, 1344],
};

export type DreamImageSize = {
    resolution: DreamImageResolution;
    ratio: DreamImageRatio;
    width: number;
    height: number;
    size: string;
};

export function dreamImageResolutionsForModel(model?: string): readonly DreamImageResolution[] {
    const normalizedModel = bareModelName(model);
    if (normalizedModel === "gemini-3.1-flash-image") return DREAM_GBI_IMAGE_RESOLUTIONS;
    if (normalizedModel === "gpt-image-2") return DREAM_GPT_IMAGE_RESOLUTIONS;
    return DREAM_IMAGE_RESOLUTIONS;
}

export function dreamImageRatiosForModel(model?: string, resolutionValue?: string): readonly DreamImageRatio[] {
    const normalizedModel = bareModelName(model);
    if (normalizedModel === "gemini-3.1-flash-image") return DREAM_GBI_IMAGE_RATIOS;
    if (normalizedModel === "gpt-image-2") {
        if (!resolutionValue) return DREAM_GPT_IMAGE_RATIOS;
        const resolution = normalizeDreamImageResolution(resolutionValue, DREAM_GPT_IMAGE_RESOLUTIONS);
        return resolution === "1k" ? DREAM_GPT_IMAGE_1K_RATIOS : DREAM_GPT_IMAGE_2K_RATIOS;
    }
    return DREAM_IMAGE_RATIOS;
}

export function isDreamGptImageModel(model?: string) {
    return bareModelName(model) === "gpt-image-2";
}

export function normalizeDreamImageQuality(value?: string): DreamImageQuality {
    const normalized = (value || "").trim().toLowerCase();
    return normalized === "low" || normalized === "high" ? normalized : "medium";
}

export function dreamImagePreset(resolution: DreamImageResolution, ratio: DreamImageRatio): DreamImageSize {
    const [baseWidth, baseHeight] = resolution === "1k" ? DREAM_IMAGE_1K_DIMENSIONS[ratio] : DREAM_IMAGE_2K_DIMENSIONS[ratio];
    const scale = resolution === "4k" ? 2 : 1;
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    return { resolution, ratio, width, height, size: `${width}x${height}` };
}

export function normalizeDreamImageResolution(value: string, supportedResolutions: readonly DreamImageResolution[] = DREAM_IMAGE_RESOLUTIONS): DreamImageResolution {
    const normalized = value.trim().toLowerCase();
    const requested = normalized === "1k" || normalized === "low" ? "1k" : normalized === "4k" || normalized === "high" ? "4k" : "2k";
    if (supportedResolutions.includes(requested)) return requested;
    if (requested === "4k") return supportedResolutions[supportedResolutions.length - 1] || "2k";
    if (requested === "1k") return supportedResolutions[0] || "2k";
    return supportedResolutions.includes("2k") ? "2k" : supportedResolutions[0] || "2k";
}

export function dreamImageSelection(resolutionValue: string, sizeValue: string, model?: string): DreamImageSize {
    const supportedResolutions = dreamImageResolutionsForModel(model);
    const resolution = normalizeDreamImageResolution(resolutionValue, supportedResolutions);
    const supportedRatios = dreamImageRatiosForModel(model, resolution);
    const fallbackRatio = defaultDreamImageRatio(supportedRatios);
    const size = sizeValue.trim().toLowerCase();
    if (isSupportedDreamImageRatio(size, supportedRatios)) return dreamImagePreset(resolution, size);
    if (isDreamImageRatio(size)) return dreamImagePreset(resolution, fallbackRatio);

    const dimensions = parseDreamImageDimensions(size);
    if (!dimensions) return dreamImagePreset(resolution, fallbackRatio);

    // Keep the resolution selected by the user. Searching every resolution
    // first would reinterpret an old size (for example 2048x2048) as the
    // previous 2K preset after the user clicks 4K.
    const exactPreset = findDreamImagePreset(dimensions.width, dimensions.height, [resolution], supportedRatios);
    if (exactPreset) return exactPreset;

    const ratio = findDreamImageRatio(dimensions.width, dimensions.height, supportedRatios);
    if (!ratio) return dreamImagePreset(resolution, fallbackRatio);
    if (model) return dreamImagePreset(resolution, ratio);
    try {
        validateDreamImageDimensions(dimensions.width, dimensions.height);
        return { resolution, ratio, ...dimensions, size: `${dimensions.width}x${dimensions.height}` };
    } catch {
        return dreamImagePreset(resolution, ratio);
    }
}

export function resolveDreamImageDimensions(sizeValue: string, resolutionValue: string, model?: string) {
    const size = sizeValue.trim().toLowerCase();
    const supportedResolutions = dreamImageResolutionsForModel(model);
    const resolution = normalizeDreamImageResolution(resolutionValue, supportedResolutions);
    const supportedRatios = dreamImageRatiosForModel(model, resolution);
    const fallbackRatio = defaultDreamImageRatio(supportedRatios);
    if (!size || size === "auto") return dimensionsOf(dreamImagePreset(resolution, fallbackRatio));
    if (isSupportedDreamImageRatio(size, supportedRatios)) return dimensionsOf(dreamImagePreset(resolution, size));
    if (isDreamImageRatio(size)) return dimensionsOf(dreamImagePreset(resolution, fallbackRatio));

    const dimensions = parseDreamImageDimensions(size);
    if (!dimensions) throw new AppError("error.dream.imageInvalidSize");
    const exactPreset = findDreamImagePreset(dimensions.width, dimensions.height, [resolution], supportedRatios);
    if (exactPreset) return dimensionsOf(exactPreset);
    const previousPreset = findDreamImagePreset(dimensions.width, dimensions.height, supportedResolutions, DREAM_IMAGE_RATIOS);
    if (previousPreset) return dimensionsOf(dreamImagePreset(resolution, findDreamImageRatio(dimensions.width, dimensions.height, supportedRatios) || fallbackRatio));
    try {
        validateDreamImageDimensions(dimensions.width, dimensions.height);
        const ratio = findDreamImageRatio(dimensions.width, dimensions.height, supportedRatios);
        if (model && ratio) return dimensionsOf(dreamImagePreset(resolution, ratio));
        return dimensions;
    } catch (error) {
        const ratio = findDreamImageRatio(dimensions.width, dimensions.height, supportedRatios);
        if (ratio) return dimensionsOf(dreamImagePreset(resolution, ratio));
        throw error;
    }
}

export function validateDreamImageDimensions(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new AppError("error.dream.imageInvalidSize");
    if (width % DREAM_IMAGE_SIZE_STEP !== 0 || height % DREAM_IMAGE_SIZE_STEP !== 0) throw new AppError("error.dream.imageSizeStep");
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (ratio > 16) throw new AppError("error.dream.imageRatioRange");
    const pixels = width * height;
    if (pixels < DREAM_IMAGE_MIN_PIXELS || pixels > DREAM_IMAGE_MAX_PIXELS) throw new AppError("error.dream.imagePixelRange");
}

function findDreamImagePreset(width: number, height: number, resolutions: readonly DreamImageResolution[], ratios: readonly DreamImageRatio[]) {
    for (const resolution of resolutions) {
        for (const ratio of ratios) {
            const preset = dreamImagePreset(resolution, ratio);
            if (preset.width === width && preset.height === height) return preset;
        }
    }
    return null;
}

function findDreamImageRatio(width: number, height: number, ratios: readonly DreamImageRatio[]) {
    return ratios.find((ratio) => {
        const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
        return width * ratioHeight === height * ratioWidth;
    });
}

function parseDreamImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function isDreamImageRatio(value: string): value is DreamImageRatio {
    return DREAM_IMAGE_RATIOS.includes(value as DreamImageRatio);
}

function isSupportedDreamImageRatio(value: string, ratios: readonly DreamImageRatio[]): value is DreamImageRatio {
    return ratios.includes(value as DreamImageRatio);
}

function defaultDreamImageRatio(ratios: readonly DreamImageRatio[]): DreamImageRatio {
    return ratios.includes("1:1") ? "1:1" : ratios[0] || "1:1";
}

function bareModelName(model?: string) {
    const value = (model || "").trim();
    const separator = value.indexOf("::");
    return separator >= 0 ? value.slice(separator + 2) : value;
}

function dimensionsOf(size: DreamImageSize) {
    return { width: size.width, height: size.height };
}
