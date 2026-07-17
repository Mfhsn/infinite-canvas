import { describe, expect, test } from "bun:test";

import { DREAM_IMAGE_RATIOS, DREAM_IMAGE_RESOLUTIONS, dreamImagePreset } from "@/lib/dream-image-size";

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
});
