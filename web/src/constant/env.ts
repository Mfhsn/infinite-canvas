export const APP_VERSION = __APP_VERSION__ || "dev";

type RuntimeEnv = Partial<Record<string, string>>;

export type EnvAiChannel = {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    apiFormat?: string;
    platformId?: number;
    models?: string[];
};

const runtimeEnv = typeof window === "undefined" ? undefined : window.__INFINITE_CANVAS_ENV__;
// Keep browser build-time env access explicit. Dynamic import.meta.env indexing
// makes Vite serialize every VITE_* value, including credentials that Integration
// mode intentionally overrides to an empty string in vite.config.ts.
const buildEnv: RuntimeEnv = {
    VITE_DOC_URL: import.meta.env.VITE_DOC_URL,
    VITE_AI_CONFIG_OVERRIDE: import.meta.env.VITE_AI_CONFIG_OVERRIDE,
    VITE_AI_CHANNELS_JSON: import.meta.env.VITE_AI_CHANNELS_JSON,
    VITE_AI_CHANNEL_ID: import.meta.env.VITE_AI_CHANNEL_ID,
    VITE_AI_CHANNEL_NAME: import.meta.env.VITE_AI_CHANNEL_NAME,
    VITE_AI_API_FORMAT: import.meta.env.VITE_AI_API_FORMAT,
    VITE_AI_BASE_URL: import.meta.env.VITE_AI_BASE_URL,
    VITE_AI_LLM_URL: import.meta.env.VITE_AI_LLM_URL,
    VITE_AI_LLM_PLATFORM_CODE: import.meta.env.VITE_AI_LLM_PLATFORM_CODE,
    VITE_AI_API_KEY: import.meta.env.VITE_AI_API_KEY,
    VITE_AI_PLATFORM_ID: import.meta.env.VITE_AI_PLATFORM_ID,
    VITE_AI_MODELS: import.meta.env.VITE_AI_MODELS,
    VITE_SHOW_IMAGE_WORKBENCH: import.meta.env.VITE_SHOW_IMAGE_WORKBENCH,
    VITE_SHOW_VIDEO_WORKBENCH: import.meta.env.VITE_SHOW_VIDEO_WORKBENCH,
    VITE_SHOW_GITHUB: import.meta.env.VITE_SHOW_GITHUB,
    VITE_SHOW_DOCS: import.meta.env.VITE_SHOW_DOCS,
    VITE_SHOW_CONFIG: import.meta.env.VITE_SHOW_CONFIG,
    VITE_SHOW_SHORTCUTS: import.meta.env.VITE_SHOW_SHORTCUTS,
    VITE_AI_TASK_TIMEOUT_MS: import.meta.env.VITE_AI_TASK_TIMEOUT_MS,
    VITE_DEFAULT_IMAGE_MODEL: import.meta.env.VITE_DEFAULT_IMAGE_MODEL,
    VITE_DEFAULT_VIDEO_MODEL: import.meta.env.VITE_DEFAULT_VIDEO_MODEL,
    VITE_DEFAULT_TEXT_MODEL: import.meta.env.VITE_DEFAULT_TEXT_MODEL,
    VITE_DEFAULT_AUDIO_MODEL: import.meta.env.VITE_DEFAULT_AUDIO_MODEL,
    VITE_DEFAULT_SYSTEM_PROMPT: import.meta.env.VITE_DEFAULT_SYSTEM_PROMPT,
    VITE_DEFAULT_IMAGE_SIZE: import.meta.env.VITE_DEFAULT_IMAGE_SIZE,
    VITE_DEFAULT_IMAGE_QUALITY: import.meta.env.VITE_DEFAULT_IMAGE_QUALITY,
    VITE_DEFAULT_IMAGE_COUNT: import.meta.env.VITE_DEFAULT_IMAGE_COUNT,
    VITE_DEFAULT_CANVAS_IMAGE_COUNT: import.meta.env.VITE_DEFAULT_CANVAS_IMAGE_COUNT,
    VITE_DEFAULT_VIDEO_SECONDS: import.meta.env.VITE_DEFAULT_VIDEO_SECONDS,
    VITE_DEFAULT_VIDEO_QUALITY: import.meta.env.VITE_DEFAULT_VIDEO_QUALITY,
    VITE_DEFAULT_AUDIO_VOICE: import.meta.env.VITE_DEFAULT_AUDIO_VOICE,
    VITE_DEFAULT_AUDIO_FORMAT: import.meta.env.VITE_DEFAULT_AUDIO_FORMAT,
    VITE_DEFAULT_AUDIO_SPEED: import.meta.env.VITE_DEFAULT_AUDIO_SPEED,
};

export const DOCS_URL = envString("VITE_DOC_URL") || "https://docs.canvas.best";
export const ENV_AI_PLATFORM_ID = envInteger("VITE_AI_PLATFORM_ID", 6);
export const ENV_AI_LLM_URL = envString("VITE_AI_LLM_URL") || "https://106.75.147.147/api/v1/ai-service/llm/chat";
export const ENV_AI_LLM_PLATFORM_CODE = envString("VITE_AI_LLM_PLATFORM_CODE") || "ucloud";
export const ENV_AI_CHANNELS = envAiChannels();
export const ENV_AI_CONFIG_OVERRIDE = envBoolean("VITE_AI_CONFIG_OVERRIDE");
export const ENV_SHOW_IMAGE_WORKBENCH = envBooleanDefault("VITE_SHOW_IMAGE_WORKBENCH", true);
export const ENV_SHOW_VIDEO_WORKBENCH = envBooleanDefault("VITE_SHOW_VIDEO_WORKBENCH", true);
export const ENV_SHOW_GITHUB = envBooleanDefault("VITE_SHOW_GITHUB", true);
export const ENV_SHOW_DOCS = envBooleanDefault("VITE_SHOW_DOCS", true);
export const ENV_SHOW_CONFIG = envBooleanDefault("VITE_SHOW_CONFIG", true);
export const ENV_SHOW_SHORTCUTS = envBooleanDefault("VITE_SHOW_SHORTCUTS", true);
export const ENV_AI_TASK_TIMEOUT_MS = envPositiveInteger("VITE_AI_TASK_TIMEOUT_MS", 15 * 60 * 1000);
export const ENV_DEFAULT_IMAGE_MODEL = envString("VITE_DEFAULT_IMAGE_MODEL");
export const ENV_DEFAULT_VIDEO_MODEL = envString("VITE_DEFAULT_VIDEO_MODEL");
export const ENV_DEFAULT_TEXT_MODEL = envString("VITE_DEFAULT_TEXT_MODEL");
export const ENV_DEFAULT_AUDIO_MODEL = envString("VITE_DEFAULT_AUDIO_MODEL");
export const ENV_DEFAULT_SYSTEM_PROMPT = envString("VITE_DEFAULT_SYSTEM_PROMPT");
export const ENV_DEFAULT_IMAGE_SIZE = envString("VITE_DEFAULT_IMAGE_SIZE");
export const ENV_DEFAULT_IMAGE_QUALITY = envString("VITE_DEFAULT_IMAGE_QUALITY");
export const ENV_DEFAULT_IMAGE_COUNT = envString("VITE_DEFAULT_IMAGE_COUNT");
export const ENV_DEFAULT_CANVAS_IMAGE_COUNT = envString("VITE_DEFAULT_CANVAS_IMAGE_COUNT");
export const ENV_DEFAULT_VIDEO_SECONDS = envString("VITE_DEFAULT_VIDEO_SECONDS");
export const ENV_DEFAULT_VIDEO_QUALITY = envString("VITE_DEFAULT_VIDEO_QUALITY");
export const ENV_DEFAULT_AUDIO_VOICE = envString("VITE_DEFAULT_AUDIO_VOICE");
export const ENV_DEFAULT_AUDIO_FORMAT = envString("VITE_DEFAULT_AUDIO_FORMAT");
export const ENV_DEFAULT_AUDIO_SPEED = envString("VITE_DEFAULT_AUDIO_SPEED");

function envString(key: string) {
    const runtimeValue = runtimeEnv?.[key];
    if (runtimeValue !== undefined) return String(runtimeValue);
    const buildValue = buildEnv[key];
    return typeof buildValue === "string" ? buildValue : "";
}

function envBoolean(key: string) {
    return ["1", "true", "yes", "on"].includes(envString(key).trim().toLowerCase());
}

function envBooleanDefault(key: string, fallback: boolean) {
    const value = envString(key).trim();
    return value ? envBoolean(key) : fallback;
}

function envAiChannels() {
    const json = envString("VITE_AI_CHANNELS_JSON").trim();
    if (json) {
        try {
            const parsed = JSON.parse(json) as unknown;
            if (Array.isArray(parsed)) return parsed.map(normalizeEnvChannel).filter(Boolean) as EnvAiChannel[];
        } catch {
            console.warn("Failed to parse VITE_AI_CHANNELS_JSON; check its JSON syntax");
        }
    }

    const baseUrl = envString("VITE_AI_BASE_URL").trim();
    const apiKey = envString("VITE_AI_API_KEY");
    const models = splitEnvList(envString("VITE_AI_MODELS"));
    if (!baseUrl && !apiKey && !models.length) return [];
    return [
        {
            id: envString("VITE_AI_CHANNEL_ID").trim() || "env-default",
            name: envString("VITE_AI_CHANNEL_NAME").trim(),
            baseUrl,
            apiKey,
            apiFormat: envString("VITE_AI_API_FORMAT").trim(),
            platformId: ENV_AI_PLATFORM_ID,
            models,
        },
    ];
}

function normalizeEnvChannel(value: unknown): EnvAiChannel | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const channel = value as Record<string, unknown>;
    return {
        id: stringValue(channel.id),
        name: stringValue(channel.name),
        baseUrl: stringValue(channel.baseUrl),
        apiKey: stringValue(channel.apiKey),
        apiFormat: stringValue(channel.apiFormat),
        platformId: integerValue(channel.platformId ?? channel.platform_id),
        models: Array.isArray(channel.models) ? channel.models.map(String).filter(Boolean) : splitEnvList(stringValue(channel.models)),
    };
}

function envInteger(key: string, fallback: number) {
    return integerValue(envString(key)) ?? fallback;
}

function envPositiveInteger(key: string, fallback: number) {
    const value = integerValue(envString(key));
    return value && value > 0 ? value : fallback;
}

function integerValue(value: unknown) {
    if (value === "" || value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function splitEnvList(value: string) {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

declare global {
    interface Window {
        __INFINITE_CANVAS_ENV__?: RuntimeEnv;
    }
}
