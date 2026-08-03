import axios from "axios";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, spyOn, test } from "bun:test";

import type { AiConfig } from "@/stores/use-config-store";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";
const { buildDreamImagePointsSpec, buildDreamVideoPointsSpec } = await import("@/lib/dream-points");
const { defaultConfig } = await import("@/stores/use-config-store");
const { dreamPointsEstimateQueryOptions } = await import("@/hooks/use-generation-points-estimate");

function dreamConfig(model: string, patch: Partial<AiConfig> = {}): AiConfig {
    const channel = defaultConfig.channels[0];
    if (!channel) throw new Error("Missing built-in Dream channel");
    const selectedModel = `${channel.id}::${model}`;
    return {
        ...defaultConfig,
        model: selectedModel,
        imageModel: selectedModel,
        videoModel: selectedModel,
        baseUrl: "http://example.test",
        apiKey: "access-token",
        channels: [{ ...channel, baseUrl: "http://example.test", apiKey: "access-token", platformId: 6, models: Array.from(new Set([...channel.models, model])) }],
        ...patch,
    };
}

describe("Dream points request mapping", () => {
    test("maps Seedream 4.5 image batches to raw model IDs and actual 4k dimensions", () => {
        const spec = buildDreamImagePointsSpec(dreamConfig("doubao-seedream-4.5", { quality: "4k", size: "9:21" }), 3, 2);

        expect(spec?.request).toEqual({
            req_key: "doubao-seedream-4.5",
            platform_id: 6,
            count: 3,
            ref_image_count: 2,
            image_quality: "high",
            size: "2592x6048",
            width: 2592,
            height: 6048,
        });
    });

    test("keeps the Seedream 5 model ID exact", () => {
        const spec = buildDreamImagePointsSpec(dreamConfig("doubao-seedream-5-0-260128", { quality: "2k", size: "1:1" }), 1, 0);

        expect(spec?.request).toEqual({
            req_key: "doubao-seedream-5-0-260128",
            platform_id: 6,
            count: 1,
            ref_image_count: 0,
            image_quality: "medium",
            size: "2048x2048",
            width: 2048,
            height: 2048,
        });
    });

    test("uses each Seedance 2.0 model ID for its own billing rule while keeping parameters consistent", () => {
        const models = ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615"];

        for (const model of models) {
            const spec = buildDreamVideoPointsSpec(dreamConfig(model, { videoSeconds: "99", videoGenerateAudio: "true" }), { imageCount: 0, videoCount: 0 });
            expect(spec?.request).toEqual({
                req_key: model,
                platform_id: 6,
                count: 1,
                duration: 15,
                audio_flag: true,
                has_input: false,
            });
        }
    });

    test("does not estimate unsupported models or non-Dream channels", () => {
        expect(buildDreamImagePointsSpec(dreamConfig("other-image-model"), 1, 0)).toBeNull();
        expect(buildDreamVideoPointsSpec({ ...dreamConfig("doubao-seedance-2-0-260128"), channels: [{ ...defaultConfig.channels[0]!, apiFormat: "openai" }] }, { imageCount: 1, videoCount: 0 })).toBeNull();
    });

    test("keeps generation blocked until a failed estimate retry succeeds", async () => {
        const post = spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: { points: null } } })
            .mockResolvedValueOnce({ data: { code: 0, message: "ok", data: { points: 24 } } });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const spec = buildDreamImagePointsSpec(dreamConfig("doubao-seedream-4.5"), 1, 0);
        let generationRequests = 0;
        const submit = async () => {
            await queryClient.fetchQuery(dreamPointsEstimateQueryOptions(spec));
            generationRequests += 1;
        };

        try {
            await expect(submit()).rejects.toMatchObject({ key: "error.dream.pointsEstimateUnavailable" });
            expect(generationRequests).toBe(0);
            await expect(submit()).resolves.toBeUndefined();
            expect(generationRequests).toBe(1);
            expect(post).toHaveBeenCalledTimes(2);
        } finally {
            post.mockRestore();
            queryClient.clear();
        }
    });
});
