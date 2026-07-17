export type GenerationLogStatus = "pending" | "success" | "failed";

const legacyGenerationLogStatuses: Record<string, GenerationLogStatus> = {
    生成中: "pending",
    成功: "success",
    失败: "failed",
};

export function normalizeGenerationLogStatus(value: unknown, fallback: GenerationLogStatus): GenerationLogStatus {
    if (value === "pending" || value === "success" || value === "failed") return value;
    return typeof value === "string" ? legacyGenerationLogStatuses[value] || fallback : fallback;
}

export function formatGenerationLogTime(createdAt: number, language: string) {
    return new Intl.DateTimeFormat(language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(new Date(createdAt));
}
