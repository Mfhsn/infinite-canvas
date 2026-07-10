export const APP_VERSION = __APP_VERSION__ || "dev";

type RuntimeEnv = Partial<Record<string, string>>;

export type EnvAiChannel = {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    apiFormat?: string;
    models?: string[];
};

const runtimeEnv = typeof window === "undefined" ? undefined : window.__INFINITE_CANVAS_ENV__;

export const DOCS_URL = envString("VITE_DOC_URL") || "https://docs.canvas.best";
export const ENV_AI_CHANNELS = envAiChannels();
export const ENV_AI_CONFIG_OVERRIDE = envBoolean("VITE_AI_CONFIG_OVERRIDE");
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
    const buildValue = import.meta.env[key];
    return typeof buildValue === "string" ? buildValue : "";
}

function envBoolean(key: string) {
    return ["1", "true", "yes", "on"].includes(envString(key).trim().toLowerCase());
}

function envAiChannels() {
    const json = envString("VITE_AI_CHANNELS_JSON").trim();
    if (json) {
        try {
            const parsed = JSON.parse(json) as unknown;
            if (Array.isArray(parsed)) return parsed.map(normalizeEnvChannel).filter(Boolean) as EnvAiChannel[];
        } catch {
            console.warn("VITE_AI_CHANNELS_JSON 解析失败，请检查 JSON 格式");
        }
    }

    const baseUrl = envString("VITE_AI_BASE_URL").trim();
    const apiKey = envString("VITE_AI_API_KEY");
    const models = splitEnvList(envString("VITE_AI_MODELS"));
    if (!baseUrl && !apiKey && !models.length) return [];
    return [
        {
            id: envString("VITE_AI_CHANNEL_ID").trim() || "env-default",
            name: envString("VITE_AI_CHANNEL_NAME").trim() || "环境变量渠道",
            baseUrl,
            apiKey,
            apiFormat: envString("VITE_AI_API_FORMAT").trim(),
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
        models: Array.isArray(channel.models) ? channel.models.map(String).filter(Boolean) : splitEnvList(stringValue(channel.models)),
    };
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
