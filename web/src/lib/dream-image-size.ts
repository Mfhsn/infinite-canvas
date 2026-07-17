import { AppError } from "@/lib/app-error";

export const DREAM_IMAGE_RESOLUTIONS = ["2k", "4k"] as const;
export const DREAM_IMAGE_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"] as const;

export type DreamImageResolution = (typeof DREAM_IMAGE_RESOLUTIONS)[number];
export type DreamImageRatio = (typeof DREAM_IMAGE_RATIOS)[number];

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

export type DreamImageSize = {
    resolution: DreamImageResolution;
    ratio: DreamImageRatio;
    width: number;
    height: number;
    size: string;
};

export function dreamImagePreset(resolution: DreamImageResolution, ratio: DreamImageRatio): DreamImageSize {
    const [baseWidth, baseHeight] = DREAM_IMAGE_2K_DIMENSIONS[ratio];
    const scale = resolution === "4k" ? 2 : 1;
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    return { resolution, ratio, width, height, size: `${width}x${height}` };
}

export function normalizeDreamImageResolution(value: string): DreamImageResolution {
    const normalized = value.trim().toLowerCase();
    return normalized === "4k" || normalized === "high" ? "4k" : "2k";
}

export function dreamImageSelection(resolutionValue: string, sizeValue: string): DreamImageSize {
    const resolution = normalizeDreamImageResolution(resolutionValue);
    const size = sizeValue.trim().toLowerCase();
    if (isDreamImageRatio(size)) return dreamImagePreset(resolution, size);

    const dimensions = parseDreamImageDimensions(size);
    if (!dimensions) return dreamImagePreset(resolution, "1:1");

    const exactPreset = findDreamImagePreset(dimensions.width, dimensions.height);
    if (exactPreset) return exactPreset;

    const ratio = findDreamImageRatio(dimensions.width, dimensions.height);
    if (!ratio) return dreamImagePreset(resolution, "1:1");
    try {
        validateDreamImageDimensions(dimensions.width, dimensions.height);
        return { resolution, ratio, ...dimensions, size: `${dimensions.width}x${dimensions.height}` };
    } catch {
        return dreamImagePreset(resolution, ratio);
    }
}

export function resolveDreamImageDimensions(sizeValue: string, resolutionValue: string) {
    const size = sizeValue.trim().toLowerCase();
    const resolution = normalizeDreamImageResolution(resolutionValue);
    if (!size || size === "auto") return dimensionsOf(dreamImagePreset(resolution, "1:1"));
    if (isDreamImageRatio(size)) return dimensionsOf(dreamImagePreset(resolution, size));

    const dimensions = parseDreamImageDimensions(size);
    if (!dimensions) throw new AppError("error.dream.imageInvalidSize");
    try {
        validateDreamImageDimensions(dimensions.width, dimensions.height);
        return dimensions;
    } catch (error) {
        const ratio = findDreamImageRatio(dimensions.width, dimensions.height);
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

function findDreamImagePreset(width: number, height: number) {
    for (const resolution of DREAM_IMAGE_RESOLUTIONS) {
        for (const ratio of DREAM_IMAGE_RATIOS) {
            const preset = dreamImagePreset(resolution, ratio);
            if (preset.width === width && preset.height === height) return preset;
        }
    }
    return null;
}

function findDreamImageRatio(width: number, height: number) {
    return DREAM_IMAGE_RATIOS.find((ratio) => {
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

function dimensionsOf(size: DreamImageSize) {
    return { width: size.width, height: size.height };
}
