import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { ENV_AI_CHANNELS, ENV_AI_CONFIG_OVERRIDE, ENV_DEFAULT_AUDIO_FORMAT, ENV_DEFAULT_AUDIO_MODEL, ENV_DEFAULT_AUDIO_SPEED, ENV_DEFAULT_AUDIO_VOICE, ENV_DEFAULT_CANVAS_IMAGE_COUNT, ENV_DEFAULT_IMAGE_COUNT, ENV_DEFAULT_IMAGE_MODEL, ENV_DEFAULT_IMAGE_QUALITY, ENV_DEFAULT_IMAGE_SIZE, ENV_DEFAULT_SYSTEM_PROMPT, ENV_DEFAULT_TEXT_MODEL, ENV_DEFAULT_VIDEO_MODEL, ENV_DEFAULT_VIDEO_QUALITY, ENV_DEFAULT_VIDEO_SECONDS, type EnvAiChannel } from "@/constant/env";

export type ApiCallFormat = "openai" | "gemini" | "dream";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const DREAM_BASE_URL = "http://prod-cn.your-api-server.com";
export const DREAM_API_MODELS = [
    "doubao-seedream-4-5-251128",
    "doubao-seedream-5-0-260128",
    "doubao-seedream-4.5",
    "jimeng_t2i_v40",
    "jimeng_t2i_v30",
    "jimeng_t2i_v31",
    "jimeng_i2i_v30",
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
    "i2i_inpainting_edit",
    "i2i_outpainting",
    "ep-20260423191105-g5gml",
    "jimeng_ti2v_v30_pro",
    "jimeng_i2v_first_tail_v30_1080",
    "jimeng_i2v_first_v30_1080",
    "jimeng_t2v_v30_1080p",
    "doubao-seedance-1-0-pro-fast-251015",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "ep-20260307130721-bx7tv",
    "dreamina-seedance-2-0-260128",
    "dreamina-seedance-2-0-fast-260128",
    "ep-20260307130821-xw5wf",
    "sora-2",
    "sora-2-pro",
    "veo-3.1-fast-generate-preview",
    "veo-3.1-generate-preview",
    "viduq2",
    "viduq2-pro",
    "viduq2-turbo",
    "MiniMax-Hailuo-2.3",
    "MiniMax-Hailuo-02",
    "MiniMax-Hailuo-2.3-Fast",
    "kling-v2-5-turbo",
    "kling-v2-6",
    "kling-v2-1-master",
    "doubao-seedance-2-0-mini-260615",
    "ep-20260507104326-dv6tk",
    "ep-20260507104238-cx2j9",
    "tts-synthesize",
];

const FALLBACK_MODELS = ["gpt-image-2", "grok-imagine-video", "gpt-5.5", "gpt-4o-mini-tts"];
const DEFAULT_CHANNELS = resolveDefaultChannels();
const DEFAULT_MODELS = modelOptionsFromChannels(DEFAULT_CHANNELS);
const DEFAULT_IMAGE_MODEL = defaultModelValue(ENV_DEFAULT_IMAGE_MODEL, "gpt-image-2", "image");
const DEFAULT_VIDEO_MODEL = defaultModelValue(ENV_DEFAULT_VIDEO_MODEL, "grok-imagine-video", "video");
const DEFAULT_TEXT_MODEL = defaultModelValue(ENV_DEFAULT_TEXT_MODEL, "gpt-5.5", "text");
const DEFAULT_AUDIO_MODEL = defaultModelValue(ENV_DEFAULT_AUDIO_MODEL, "gpt-4o-mini-tts", "audio");

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: DEFAULT_CHANNELS[0]?.baseUrl || OPENAI_BASE_URL,
    apiKey: DEFAULT_CHANNELS[0]?.apiKey || "",
    apiFormat: DEFAULT_CHANNELS[0]?.apiFormat || "openai",
    channels: DEFAULT_CHANNELS,
    model: DEFAULT_IMAGE_MODEL || DEFAULT_MODELS[0] || "",
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: DEFAULT_VIDEO_MODEL,
    textModel: DEFAULT_TEXT_MODEL,
    audioModel: DEFAULT_AUDIO_MODEL,
    audioVoice: ENV_DEFAULT_AUDIO_VOICE || "alloy",
    audioFormat: ENV_DEFAULT_AUDIO_FORMAT || "mp3",
    audioSpeed: ENV_DEFAULT_AUDIO_SPEED || "1",
    audioInstructions: "",
    videoSeconds: ENV_DEFAULT_VIDEO_SECONDS || "6",
    vquality: ENV_DEFAULT_VIDEO_QUALITY || "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: ENV_DEFAULT_SYSTEM_PROMPT,
    models: DEFAULT_MODELS,
    imageModels: defaultModelList("image", DEFAULT_IMAGE_MODEL),
    videoModels: defaultModelList("video", DEFAULT_VIDEO_MODEL),
    textModels: defaultModelList("text", DEFAULT_TEXT_MODEL),
    audioModels: defaultModelList("audio", DEFAULT_AUDIO_MODEL),
    quality: ENV_DEFAULT_IMAGE_QUALITY || "auto",
    size: ENV_DEFAULT_IMAGE_SIZE || "1:1",
    count: ENV_DEFAULT_IMAGE_COUNT || "1",
    canvasImageCount: ENV_DEFAULT_CANVAS_IMAGE_COUNT || "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

function resolveDefaultChannels() {
    const envChannels = ENV_AI_CHANNELS.map((channel, index) => envChannelToModelChannel(channel, index));
    return envChannels.length
        ? envChannels
        : [
              createModelChannel({
                  id: "default",
                  name: "默认渠道",
                  baseUrl: OPENAI_BASE_URL,
                  apiKey: "",
                  apiFormat: "openai",
                  models: FALLBACK_MODELS,
              }),
          ];
}

function envChannelToModelChannel(channel: EnvAiChannel, index: number) {
    const apiFormat = normalizeApiFormat(channel.apiFormat);
    return createModelChannel({
        id: channel.id || (index === 0 ? "env-default" : `env-channel-${index + 1}`),
        name: channel.name || (index === 0 ? "环境变量渠道" : `环境变量渠道 ${index + 1}`),
        baseUrl: channel.baseUrl || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel.apiKey || "",
        apiFormat,
        models: channel.models?.length ? channel.models : defaultModelsForApiFormat(apiFormat),
    });
}

function defaultModelValue(envValue: string, fallback: string, capability: ModelCapability) {
    const envModel = normalizeModelOptionValue(envValue, DEFAULT_CHANNELS);
    if (envModel) return envModel;
    const matching = filterModelsByCapability(DEFAULT_MODELS, capability);
    if (matching.length) return matching[0];
    return normalizeModelOptionValue(fallback, DEFAULT_CHANNELS) || DEFAULT_MODELS[0] || fallback;
}

function defaultModelList(capability: ModelCapability, selected: string) {
    const models = filterModelsByCapability(DEFAULT_MODELS, capability);
    return models.length ? models : selected ? [selected] : [];
}

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo") || value.includes("vidu") || value.includes("t2v") || value.includes("i2v") || value === "ep-20260307130721-bx7tv" || value === "ep-20260307130821-xw5wf" || value === "ep-20260507104326-dv6tk" || value === "ep-20260507104238-cx2j9";
}

function isImageModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return !isVideoModelName(model) && !isAudioModelName(model) && (value.includes("seedream") || value.includes("t2i") || value.includes("i2i") || value.includes("inpainting") || value.includes("outpainting") || value === "ep-20260423191105-g5gml" || value.includes("gpt-image") || value.includes("image") || value.includes("dall-e") || value.includes("dalle") || value.includes("imagen") || value.includes("flux") || value.includes("sdxl") || value.includes("stable-diffusion") || value.includes("midjourney"));
}

function isAudioModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && (channel.apiFormat === "dream" || channel.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (ENV_AI_CONFIG_OVERRIDE) {
                    config.channels = defaultConfig.channels;
                    config.baseUrl = defaultConfig.baseUrl;
                    config.apiKey = defaultConfig.apiKey;
                    config.apiFormat = defaultConfig.apiFormat;
                    config.model = defaultConfig.model;
                    config.imageModel = defaultConfig.imageModel;
                    config.videoModel = defaultConfig.videoModel;
                    config.textModel = defaultConfig.textModel;
                    config.audioModel = defaultConfig.audioModel;
                    config.models = defaultConfig.models;
                    config.imageModels = defaultConfig.imageModels;
                    config.videoModels = defaultConfig.videoModels;
                    config.textModels = defaultConfig.textModels;
                    config.audioModels = defaultConfig.audioModels;
                }
                if (!Array.isArray(persistedConfig.channels) && !ENV_AI_CONFIG_OVERRIDE) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                const usePersistedModelLists = !ENV_AI_CONFIG_OVERRIDE;
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel || defaultConfig.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                        imageModels: usePersistedModelLists && Array.isArray(persistedConfig.imageModels) ? normalizeModelList(config.imageModels, channels) : filterModelsByCapability(models, "image"),
                        videoModels: usePersistedModelLists && Array.isArray(persistedConfig.videoModels) ? normalizeModelList(config.videoModels, channels) : filterModelsByCapability(models, "video"),
                        textModels: usePersistedModelLists && Array.isArray(persistedConfig.textModels) ? normalizeModelList(config.textModels, channels) : filterModelsByCapability(models, "text"),
                        audioModels: usePersistedModelLists && Array.isArray(persistedConfig.audioModels) ? normalizeModelList(config.audioModels, channels) : filterModelsByCapability(models, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[], channels: ModelChannel[]) {
    const allModelOptions = channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model)));
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)))
        .map((model) => normalizeModelOptionValue(model, channels))
        .filter((model) => !allModelOptions.length || allModelOptions.includes(model) || !isChannelModelValue(model));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: uniqueRawModels(channel?.models || defaultModelsForApiFormat(apiFormat)),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.includes(decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.includes(model)) || channels[0];
    return channel && channel.models.includes(model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.includes(model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: uniqueRawModels(channel.models || []),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: uniqueRawModels([
                    ...(config.models || []),
                    config.model,
                    config.imageModel,
                    config.videoModel,
                    config.textModel,
                    config.audioModel,
                ]),
            }),
        );
    }
    return channels.map((channel) => ({ ...channel, models: uniqueRawModels(channel.models) }));
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "dream") return DREAM_BASE_URL;
    return OPENAI_BASE_URL;
}

export function defaultModelsForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "dream" ? DREAM_API_MODELS : [];
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    if (apiFormat === "gemini" || apiFormat === "dream") return apiFormat;
    return "openai";
}

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map((model) => modelOptionName(model).trim()).filter(Boolean)));
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
