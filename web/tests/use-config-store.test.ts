import { describe, expect, test } from "bun:test";
import { afterEach } from "bun:test";
import { CANVAS_SESSION_BINDING_HEADER, capturePlatformSessionBinding, clearPlatformSessionBinding } from "@/services/platform-session";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";
process.env.VITE_AI_PLATFORM_ID = "6";
process.env.VITE_DREAM_IMAGE_PLATFORM_ID = "16";
process.env.VITE_DREAM_VIDEO_PLATFORM_ID = "17";

afterEach(() => clearPlatformSessionBinding());

describe("built-in AI channel defaults", () => {
    test("uses only the API example channel and its documented defaults", async () => {
        const { dreamImagePlatformId, dreamVideoPlatformId } = await import("@/constant/env");
        const { defaultConfig, DREAM_API_MODELS, DREAM_IMAGE_MODELS, DREAM_TEXT_MODELS, DREAM_VIDEO_MODELS, encodeChannelModel, modelOptionDisplayName, modelOptionLabel, modelOptionName, resolveModelRequestConfig, useConfigStore } =
            await import("@/stores/use-config-store");
        expect(dreamImagePlatformId()).toBe(16);
        expect(dreamVideoPlatformId()).toBe(17);
        expect(DREAM_IMAGE_MODELS).toEqual(["doubao-seedream-4.5", "doubao-seedream-5-0-260128", "gemini-3.1-flash-image", "gpt-image-2"]);
        expect(DREAM_VIDEO_MODELS).toEqual(["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615", "doubao-seedance-2-5-260628"]);
        expect(DREAM_TEXT_MODELS).toEqual(["doubao-1.5-pro", "doubao-seed-2-1-pro-260628", "glm-5.2", "gemini-2.5-pro"]);
        expect(DREAM_API_MODELS).toEqual([...DREAM_IMAGE_MODELS, ...DREAM_VIDEO_MODELS, ...DREAM_TEXT_MODELS, "tts-synthesize"]);
        expect(defaultConfig.channels).toHaveLength(1);
        expect(defaultConfig.channels[0]).toMatchObject({
            id: "dream-default",
            name: "",
            apiFormat: "dream",
            baseUrl: "https://prod-cn.your-api-server.com",
            platformId: 6,
            models: DREAM_API_MODELS,
        });
        expect(defaultConfig.platformId).toBe(6);
        expect(resolveModelRequestConfig(defaultConfig, defaultConfig.imageModel).platformId).toBe(6);
        expect(useConfigStore.getState().isAiConfigReady({ ...defaultConfig, apiKey: "", channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "" })) }, defaultConfig.imageModel)).toBe(false);
        capturePlatformSessionBinding(new Response(null, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-1" } }));
        expect(useConfigStore.getState().isAiConfigReady({ ...defaultConfig, apiKey: "", channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "" })) }, defaultConfig.imageModel)).toBe(true);
        expect(defaultConfig.imageModels.map(modelOptionName)).toEqual(DREAM_IMAGE_MODELS);
        expect(defaultConfig.videoModels.map(modelOptionName)).toEqual(DREAM_VIDEO_MODELS);
        expect(modelOptionName(defaultConfig.imageModel)).toBe("doubao-seedream-4.5");
        expect(defaultConfig.quality).toBe("2k");
        expect(defaultConfig.size).toBe("1:1");
        expect(modelOptionName(defaultConfig.videoModel)).toBe("doubao-seedance-2-0-260128");
        expect(defaultConfig.videoMode).toBe("start-end");
        expect(defaultConfig.videoSeed).toBe("-1");
        expect(defaultConfig.videoGenerateAudio).toBe("false");
        expect(modelOptionName(defaultConfig.audioModel)).toBe("tts-synthesize");
        expect(defaultConfig.textModels.map(modelOptionName)).toEqual(DREAM_TEXT_MODELS);
        expect(modelOptionName(defaultConfig.textModel)).toBe("doubao-1.5-pro");
        expect(modelOptionDisplayName("gemini-3.1-flash-image")).toBe("GBI 3.1");
        expect(modelOptionDisplayName("gpt-image-2")).toBe("GP image 2");
        expect(modelOptionDisplayName("doubao-seedream-5-0-260128")).toBe("Seedream 5.0 pro");
        expect(modelOptionDisplayName("doubao-seed-2-1-pro-260628")).toBe("Doubao 2.1 pro");
        expect(modelOptionDisplayName("glm-5.2")).toBe("GLM 5.2");
        expect(modelOptionDisplayName("gemini-2.5-pro")).toBe("GMI 2.5 pro");
        expect(modelOptionDisplayName("doubao-seedance-2-5-260628")).toBe("Seedance 2.5");
        expect(modelOptionLabel({ ...defaultConfig, channels: [{ ...defaultConfig.channels[0], name: "qixiang" }] }, encodeChannelModel("dream-default", "gpt-image-2"))).toBe("GP image 2");
    });

    test("uses model-specific canvas video input modes", async () => {
        const { defaultDreamVideoMode, dreamVideoModes } = await import("@/lib/seedance-video");
        for (const model of ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615"]) {
            expect(defaultDreamVideoMode(model)).toBe("subject");
            expect(dreamVideoModes(model)).toEqual(["start-end", "subject"]);
        }
    });

    test("uses selectable resolution only for the standard Seedance 2.0 model", async () => {
        const { dreamVideoResolutionOptions, isDreamVideoResolutionSelectable, normalizeDreamVideoResolution } = await import("@/lib/seedance-video");
        const standard = "doubao-seedance-2-0-260128";
        const fast = "doubao-seedance-2-0-fast-260128";
        const mini = "doubao-seedance-2-0-mini-260615";

        expect(dreamVideoResolutionOptions).toEqual([
            { value: "720p", label: "720p" },
            { value: "1080p", label: "1080p" },
            { value: "4K", label: "4K" },
        ]);
        expect(isDreamVideoResolutionSelectable(standard)).toBe(true);
        expect(isDreamVideoResolutionSelectable(fast)).toBe(false);
        expect(isDreamVideoResolutionSelectable(mini)).toBe(false);
        expect(normalizeDreamVideoResolution("1080p", standard)).toBe("1080p");
        expect(normalizeDreamVideoResolution("4k", standard)).toBe("4K");
        expect(normalizeDreamVideoResolution("4K", fast)).toBe("720p");
        expect(normalizeDreamVideoResolution("1080p", mini)).toBe("720p");
    });

    test("removes legacy browser credentials when Integration is enabled", async () => {
        const { clearPersistedAiCredentials, useConfigStore } = await import("@/stores/use-config-store");
        const original = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...original,
                apiKey: "legacy-key",
                channels: original.channels.map((channel) => ({ ...channel, apiKey: "legacy-channel-key" })),
            },
        });
        clearPersistedAiCredentials();
        expect(useConfigStore.getState().config.apiKey).toBe("");
        expect(useConfigStore.getState().config.channels.every((channel) => channel.apiKey === "")).toBe(true);
        useConfigStore.setState({ config: original });
    });
});
