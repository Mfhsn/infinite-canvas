import { describe, expect, test } from "bun:test";
import { afterEach } from "bun:test";
import { CANVAS_SESSION_BINDING_HEADER, capturePlatformSessionBinding, clearPlatformSessionBinding } from "@/services/platform-session";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";
process.env.VITE_AI_PLATFORM_ID = "6";

afterEach(() => clearPlatformSessionBinding());

describe("built-in AI channel defaults", () => {
    test("uses only the API example channel and its documented defaults", async () => {
        const { defaultConfig, DREAM_API_MODELS, DREAM_IMAGE_MODELS, DREAM_TEXT_MODELS, DREAM_VIDEO_MODELS, modelOptionName, resolveModelRequestConfig, useConfigStore } = await import("@/stores/use-config-store");
        expect(DREAM_IMAGE_MODELS).toEqual(["doubao-seedream-4.5", "doubao-seedream-5-0-260128"]);
        expect(DREAM_VIDEO_MODELS).toEqual(["doubao-seedance-1-5-pro-251215", "doubao-seedance-2-0-260128"]);
        expect(DREAM_TEXT_MODELS).toEqual(["doubao-1.5-pro"]);
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
        expect(modelOptionName(defaultConfig.videoModel)).toBe("doubao-seedance-1-5-pro-251215");
        expect(defaultConfig.videoMode).toBe("start-end");
        expect(defaultConfig.videoSeed).toBe("-1");
        expect(defaultConfig.videoGenerateAudio).toBe("false");
        expect(modelOptionName(defaultConfig.audioModel)).toBe("tts-synthesize");
        expect(defaultConfig.textModels.map(modelOptionName)).toEqual(DREAM_TEXT_MODELS);
        expect(modelOptionName(defaultConfig.textModel)).toBe("doubao-1.5-pro");
    });

    test("uses model-specific canvas video input modes", async () => {
        const { defaultDreamVideoMode, dreamVideoModes } = await import("@/lib/seedance-video");
        expect(defaultDreamVideoMode("doubao-seedance-1-5-pro-251215")).toBe("start-end");
        expect(dreamVideoModes("doubao-seedance-1-5-pro-251215")).toEqual(["start-end"]);
        expect(defaultDreamVideoMode("doubao-seedance-2-0-260128")).toBe("subject");
        expect(dreamVideoModes("doubao-seedance-2-0-260128")).toEqual(["start-end", "subject"]);
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
