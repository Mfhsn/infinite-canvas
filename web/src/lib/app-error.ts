import type { I18nKey, I18nParams, I18nTranslator } from "@/i18n/messages";

export class AppError extends Error {
    readonly key: I18nKey;
    readonly params?: I18nParams;
    readonly rawMessage?: string;

    constructor(key: I18nKey, params?: I18nParams, options?: { cause?: unknown; rawMessage?: unknown }) {
        const rawMessage = errorMessageText(options?.rawMessage);
        super(rawMessage || key, { cause: options?.cause });
        this.name = "AppError";
        this.key = key;
        this.params = params;
        this.rawMessage = rawMessage || undefined;
    }
}

export function localizeError(error: unknown, t: I18nTranslator, fallback: I18nKey) {
    if (error instanceof AppError) return error.rawMessage || t(error.key, error.params);
    if (error instanceof Error && error.message) return error.message;
    return t(fallback);
}

const storedErrorPrefix = "i18n:";

export function storeError(error: unknown, fallback: I18nKey) {
    if (error instanceof AppError) {
        if (error.rawMessage) return error.rawMessage;
        return storeErrorKey(error.key, error.params);
    }
    if (error instanceof Error && error.message) return error.message;
    return storeErrorKey(fallback);
}

export function storeErrorKey(key: I18nKey, params?: I18nParams) {
    return `${storedErrorPrefix}${JSON.stringify({ key, params })}`;
}

export function localizeStoredError(value: unknown, t: I18nTranslator, fallback: I18nKey) {
    if (!value) return t(fallback);
    if (value instanceof AppError) return value.rawMessage || t(value.key, value.params);
    if (value instanceof Error) return value.message || t(fallback);
    if (typeof value === "object") {
        const descriptor = value as Record<string, unknown>;
        if (typeof descriptor.key === "string") return t(descriptor.key as I18nKey, descriptor.params && typeof descriptor.params === "object" ? (descriptor.params as I18nParams) : undefined);
        return errorMessageText(value) || t(fallback);
    }
    if (typeof value !== "string") return t(fallback);
    if (!value.startsWith(storedErrorPrefix)) return legacyStoredErrorKey(value) ? t(legacyStoredErrorKey(value)!) : value;
    try {
        const descriptor = JSON.parse(value.slice(storedErrorPrefix.length)) as { key?: I18nKey; params?: I18nParams };
        return descriptor.key ? t(descriptor.key, descriptor.params) : t(fallback);
    } catch {
        return t(fallback);
    }
}

function legacyStoredErrorKey(value: string): I18nKey | undefined {
    const legacy: Record<string, I18nKey> = {
        "页面刷新后生成已中断，请重新生成。": "canvas.generationInterrupted",
        所有图片生成失败: "canvas.allImagesFailed",
        重试所需的参考图已丢失: "canvas.retryReferenceLost",
    };
    return legacy[value];
}

export function requestError(status: number | undefined, fallback: I18nKey, rawMessage?: unknown) {
    const message = errorMessageText(rawMessage);
    if (message) return new AppError(fallback, undefined, { rawMessage: message });
    if (status === 401 || status === 403) return new AppError("error.authFailed");
    if (status === 429) return new AppError("error.rateLimited");
    return new AppError(fallback, { status: status ? `: ${status}` : "" });
}

export function errorMessageText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message.trim();
    if (Array.isArray(value)) return value.map(errorMessageText).filter(Boolean).join("；");
    if (!value || typeof value !== "object") return "";
    const detail = value as Record<string, unknown>;
    const message = errorMessageText(detail.rawMessage ?? detail.msg ?? detail.message ?? detail.detail ?? detail.error);
    const location = Array.isArray(detail.loc)
        ? detail.loc
              .map(String)
              .filter((part) => part !== "body")
              .join(".")
        : "";
    return location && message ? `${location}: ${message}` : message;
}
