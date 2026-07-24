export const HOST_EXTERNAL_AUTH_SESSION_KEY = "ai-comic-external-auth-session";
export const HOST_INTEGRATION_SESSION_KEY = "ai-comic-integration-session";
export const HOST_CURRENT_PROJECT_ID_KEY = "ai-comic-current-project-id";
export const HOST_CURRENT_USER_ID_KEY = "ai-comic-current-user-id";

type StorageAccess = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type HostPlatformSession = {
    externalToken: string;
    refreshToken: string | null;
    externalProjectId: string | null;
};

function browserStorage(): StorageAccess | null {
    if (typeof localStorage === "undefined") return null;
    try {
        return localStorage;
    } catch {
        return null;
    }
}

export function readHostPlatformSession(storage: StorageAccess | null = browserStorage()): HostPlatformSession | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(HOST_EXTERNAL_AUTH_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const value = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? (parsed.data as Record<string, unknown>) : parsed;
        const externalToken = stringValue(value.external_token ?? value.externalToken ?? value.token, true);
        if (!externalToken) return null;
        return {
            externalToken,
            refreshToken: stringValue(value.refresh_token ?? value.refreshToken),
            externalProjectId:
                projectIdValue(storage.getItem(HOST_CURRENT_PROJECT_ID_KEY))
                ?? projectIdValue(
                    value.external_project_id
                    ?? value.externalProjectId
                    ?? value.current_project_id
                    ?? value.currentProjectId
                    ?? value.project_id
                    ?? value.projectId,
                ),
        };
    } catch {
        return null;
    }
}

export function writeHostCurrentProjectId(projectId: string, storage: StorageAccess | null = browserStorage()) {
    if (!storage) return;
    try {
        storage.setItem(HOST_CURRENT_PROJECT_ID_KEY, projectId);
    } catch {
        // The server session remains authoritative when browser storage is restricted.
    }
}

export function clearHostPlatformSession(storage: StorageAccess | null = browserStorage()) {
    if (!storage) return;
    for (const key of [HOST_EXTERNAL_AUTH_SESSION_KEY, HOST_INTEGRATION_SESSION_KEY, HOST_CURRENT_PROJECT_ID_KEY, HOST_CURRENT_USER_ID_KEY]) {
        try {
            storage.removeItem(key);
        } catch {
            // Continue clearing the remaining host session keys.
        }
    }
}

export function subscribeToHostPlatformSessionChanges(listener: () => void) {
    if (typeof window === "undefined") return () => undefined;
    const watched = new Set([HOST_EXTERNAL_AUTH_SESSION_KEY, HOST_CURRENT_PROJECT_ID_KEY, HOST_CURRENT_USER_ID_KEY]);
    const onStorage = (event: StorageEvent) => {
        if (event.key && watched.has(event.key)) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
}

function stringValue(value: unknown, stripBearerPrefix = false): string | null {
    if (typeof value !== "string" && typeof value !== "number") return null;
    let result = String(value).trim();
    if (stripBearerPrefix) result = result.replace(/^Bearer\s+/i, "").trim();
    return result || null;
}

function projectIdValue(value: unknown, depth = 0): string | null {
    if (depth > 3 || value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            try {
                return projectIdValue(JSON.parse(trimmed), depth + 1);
            } catch {
                return null;
            }
        }
        return trimmed;
    }
    if (typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    for (const key of ["external_project_id", "externalProjectId", "current_project_id", "currentProjectId", "project_id", "projectId", "id"]) {
        const result = projectIdValue(record[key], depth + 1);
        if (result) return result;
    }
    return projectIdValue(record.data ?? record.state ?? record.value, depth + 1);
}
