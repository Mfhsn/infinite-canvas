import axios from "axios";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { AppError, requestError } from "@/lib/app-error";
import { requestDreamAudioGeneration } from "@/services/api/dream";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
    };
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const model = requestConfig.model.trim();
    assertAudioConfig(requestConfig, model);
    if (requestConfig.apiFormat === "dream") return requestDreamAudioGeneration(requestConfig, prompt, options);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const instructions = config.audioInstructions.trim();

    try {
        const response = await axios.post<Blob>(
            aiApiUrl(requestConfig, "/audio/speech"),
            {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(config.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
            { headers: aiHeaders(requestConfig), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
    } catch (error) {
        throw readAxiosError(error);
    }
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new AppError("error.audio.modelRequired");
    if (!config.baseUrl.trim()) throw new AppError("error.config.baseUrlRequired");
    if (config.apiFormat !== "dream" && !config.apiKey.trim()) throw new AppError("error.config.apiKeyRequired");
    if (config.apiFormat === "gemini") throw new AppError("error.audio.geminiUnsupported");
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw payload.msg ? new AppError("error.audio.generationFailed", undefined, { rawMessage: payload.msg }) : new AppError("error.audio.generationFailed", { status: "" });
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readAxiosError(error: unknown) {
    if (error instanceof AppError) return error;
    if (axios.isCancel(error)) return new AppError("error.requestCancelled");
    if (axios.isAxiosError<{ error?: { message?: string }; message?: string; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        const rawMessage = responseData?.msg || responseData?.message || responseData?.error?.message;
        return requestError(error.response?.status, "error.audio.generationFailed", rawMessage);
    }
    return error instanceof Error ? error : requestError(undefined, "error.audio.generationFailed");
}
