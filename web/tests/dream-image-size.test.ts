import { describe, expect, test } from "bun:test";

import {
    DREAM_GBI_IMAGE_RATIOS,
    DREAM_GBI_IMAGE_RESOLUTIONS,
    DREAM_GPT_IMAGE_1K_RATIOS,
    DREAM_GPT_IMAGE_2K_RATIOS,
    DREAM_GPT_IMAGE_RATIOS,
    DREAM_GPT_IMAGE_RESOLUTIONS,
    DREAM_IMAGE_RATIOS,
    DREAM_IMAGE_RESOLUTIONS,
    dreamImagePreset,
    dreamImageSelection,
    dreamImageRatiosForModel,
    dreamImageResolutionsForModel,
    normalizeDreamImageQuality,
    resolveDreamImageDimensions,
} from "@/lib/dream-image-size";

const expected2k = {
    "1:1": [2048, 2048],
    "4:3": [2304, 1728],
    "3:4": [1728, 2304],
    "3:2": [2496, 1664],
    "2:3": [1664, 2496],
    "16:9": [2560, 1440],
    "9:16": [1440, 2560],
    "21:9": [3024, 1296],
    "9:21": [1296, 3024],
} as const;

describe("Dream image dimensions", () => {
    test("maps every supported 2K ratio to the documented dimensions", () => {
        expect(DREAM_IMAGE_RESOLUTIONS).toEqual(["2k", "4k"]);
        expect(DREAM_IMAGE_RATIOS).toEqual(Object.keys(expected2k));

        for (const ratio of DREAM_IMAGE_RATIOS) {
            const [width, height] = expected2k[ratio];
            expect(dreamImagePreset("2k", ratio)).toEqual({ resolution: "2k", ratio, width, height, size: `${width}x${height}` });
        }
    });

    test("doubles both dimensions for 4K while staying inside the API pixel range", () => {
        for (const ratio of DREAM_IMAGE_RATIOS) {
            const size2k = dreamImagePreset("2k", ratio);
            const size4k = dreamImagePreset("4k", ratio);
            expect(size4k.width).toBe(size2k.width * 2);
            expect(size4k.height).toBe(size2k.height * 2);
            expect(size4k.width % 16).toBe(0);
            expect(size4k.height % 16).toBe(0);
            expect(size4k.width * size4k.height).toBeGreaterThanOrEqual(3_686_400);
            expect(size4k.width * size4k.height).toBeLessThanOrEqual(16_777_216);
        }
    });

    test("exposes the model-specific resolution and ratio choices", () => {
        expect(dreamImageResolutionsForModel("gemini-3.1-flash-image")).toEqual(DREAM_GBI_IMAGE_RESOLUTIONS);
        expect(dreamImageRatiosForModel("gemini-3.1-flash-image")).toEqual(DREAM_GBI_IMAGE_RATIOS);
        expect(dreamImageResolutionsForModel("dream-default::gpt-image-2")).toEqual(DREAM_GPT_IMAGE_RESOLUTIONS);
        expect(dreamImageRatiosForModel("dream-default::gpt-image-2")).toEqual(DREAM_GPT_IMAGE_RATIOS);
        expect(dreamImageRatiosForModel("gpt-image-2", "1k")).toEqual(DREAM_GPT_IMAGE_1K_RATIOS);
        expect(dreamImageRatiosForModel("gpt-image-2", "2k")).toEqual(DREAM_GPT_IMAGE_2K_RATIOS);
    });

    test("uses 1024x1024 as the GBI 1K square preset", () => {
        expect(dreamImagePreset("1k", "1:1")).toEqual({ resolution: "1k", ratio: "1:1", width: 1024, height: 1024, size: "1024x1024" });
        expect(resolveDreamImageDimensions("1:1", "1k", "gemini-3.1-flash-image")).toEqual({ width: 1024, height: 1024 });
        expect(dreamImageSelection("1k", "1024x1024", "gemini-3.1-flash-image")).toEqual({ resolution: "1k", ratio: "1:1", width: 1024, height: 1024, size: "1024x1024" });
    });

    test("maps all supported GBI 1K ratios to dimensions", () => {
        const expected1k = {
            "21:9": [1344, 576],
            "16:9": [1280, 720],
            "4:3": [1152, 864],
            "1:1": [1024, 1024],
            "3:4": [864, 1152],
            "9:16": [720, 1280],
        } as const;

        for (const ratio of DREAM_GBI_IMAGE_RATIOS) {
            const [width, height] = expected1k[ratio];
            expect(resolveDreamImageDimensions(ratio, "1k", "gemini-3.1-flash-image")).toEqual({ width, height });
        }
    });

    test("uses a resolution-specific GPT Image 2 ratio and normalizes legacy settings", () => {
        expect(resolveDreamImageDimensions("1:1", "1k", "gpt-image-2")).toEqual({ width: 1024, height: 1024 });
        expect(resolveDreamImageDimensions("16:9", "2k", "gpt-image-2")).toEqual({ width: 2560, height: 1440 });
        expect(resolveDreamImageDimensions("1:1", "2k", "gpt-image-2")).toEqual({ width: 2560, height: 1440 });
        expect(dreamImageSelection("4k", "21:9", "gpt-image-2")).toEqual({ resolution: "2k", ratio: "16:9", width: 2560, height: 1440, size: "2560x1440" });
    });

    test("keeps the newly selected resolution when the previous size matches another preset", () => {
        expect(dreamImageSelection("4k", "2048x2048", "gemini-3.1-flash-image")).toEqual({ resolution: "4k", ratio: "1:1", width: 4096, height: 4096, size: "4096x4096" });
        expect(resolveDreamImageDimensions("2048x2048", "4k", "gemini-3.1-flash-image")).toEqual({ width: 4096, height: 4096 });
        expect(dreamImageSelection("2k", "1024x1024", "gpt-image-2")).toEqual({ resolution: "2k", ratio: "16:9", width: 2560, height: 1440, size: "2560x1440" });
        expect(resolveDreamImageDimensions("1024x1024", "2k", "gpt-image-2")).toEqual({ width: 2560, height: 1440 });
    });

    test("normalizes GPT Image 2 quality values to the API enum", () => {
        expect(normalizeDreamImageQuality("low")).toBe("low");
        expect(normalizeDreamImageQuality("HIGH")).toBe("high");
        expect(normalizeDreamImageQuality("unknown")).toBe("medium");
    });
});
