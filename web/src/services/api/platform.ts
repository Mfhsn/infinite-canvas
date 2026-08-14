import { capturePlatformSessionBinding, clearPlatformSessionBinding, notifyPlatformSessionChange, withPlatformSessionBinding } from "@/services/platform-session";
import { appPath } from "@/lib/app-base-path";

export type PlatformConfig = {
    enabled: boolean;
};

export type PlatformContext = {
    authenticated: true;
    uid: string;
    username: string;
    nickname: string;
    permissionIds: number[];
    currentPoints: number | null;
    localProjectId: number | null;
    externalProjectId: string | null;
    sourceSystem: string;
    expiresAt: string;
};

export type PlatformProject = {
    projectId: string;
    name: string;
    points: number | null;
    permissionIds: number[];
};

export type CreatePlatformProjectInput = {
    name: string;
    content?: string | null;
    tag: string;
    skill: number[];
    skillModel?: string[];
};

export type CreateOnboardingProjectInput = {
    name: string;
    content?: string | null;
};

export type OnboardingProjectCreateResult = {
    project: PlatformProject | null;
    projects: PlatformProject[];
};

export type PlatformSessionBootstrapInput = {
    externalToken: string;
    refreshToken: string | null;
    externalProjectId: string | null;
};

type PlatformErrorBody = {
    error?: string | { code?: string; message?: string };
    message?: string;
    msg?: string;
};

export class PlatformApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string,
    ) {
        super(message);
        this.name = "PlatformApiError";
    }
}

function finitePoints(value: unknown) {
    return value === null || value === undefined ? null : typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safePermissionIds(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is number => Number.isSafeInteger(item)) : [];
}

export function normalizePlatformProject(value: unknown): PlatformProject | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const projectId = record.projectId ?? record.project_id ?? record.id;
    if ((typeof projectId !== "string" && typeof projectId !== "number") || !String(projectId).trim()) return null;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : String(projectId);
    return {
        projectId: String(projectId),
        name,
        points: finitePoints(record.points ?? record.currentPoints ?? record.current_points),
        permissionIds: safePermissionIds(record.permissionIds ?? record.permission_ids),
    };
}

export function normalizePlatformProjects(value: unknown) {
    const source = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { projects?: unknown }).projects) ? (value as { projects: unknown[] }).projects : [];
    return source.flatMap((item) => {
        const project = normalizePlatformProject(item);
        return project ? [project] : [];
    });
}

async function platformRequest<T>(path: string, init?: RequestInit, captureBinding = false): Promise<T> {
    let response: Response;
    try {
        response = await fetch(appPath(path), {
            ...init,
            credentials: "include",
            headers: withPlatformSessionBinding({
                Accept: "application/json",
                ...(init?.body ? { "Content-Type": "application/json" } : {}),
                ...init?.headers,
            }),
        });
    } catch (error) {
        throw new PlatformApiError(error instanceof Error ? error.message : "Platform request failed", 0);
    }
    const body = await readJson(response);
    if (!response.ok) {
        const error = body as PlatformErrorBody | null;
        const nestedError = typeof error?.error === "object" ? error.error : undefined;
        const message = nestedError?.message || (typeof error?.error === "string" ? error.error : undefined) || error?.message || error?.msg || response.statusText || "Platform request failed";
        throw new PlatformApiError(message, response.status, nestedError?.code);
    }
    if (captureBinding) capturePlatformSessionBinding(response);
    return body as T;
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        throw new PlatformApiError("Platform returned an invalid JSON response", response.status);
    }
}

function postJson<T>(path: string, body?: unknown, captureBinding = false) {
    return platformRequest<T>(
        path,
        {
            method: "POST",
            body: body === undefined ? undefined : JSON.stringify(body),
        },
        captureBinding,
    );
}

export const platformApi = {
    getConfig: () => platformRequest<PlatformConfig>("/api/platform/config"),
    bootstrapSession: (input: PlatformSessionBootstrapInput) => postJson<PlatformContext>("/api/platform/session/bootstrap", input, true),
    listOnboardingProjects: async (externalToken: string) => normalizePlatformProjects(await postJson<unknown>("/api/platform/onboarding/projects/list", { externalToken })),
    createOnboardingProject: async (externalToken: string, input: CreateOnboardingProjectInput): Promise<OnboardingProjectCreateResult> => {
        const result = await postJson<{ project?: unknown; projects?: unknown }>("/api/platform/onboarding/projects/create", {
            externalToken,
            name: input.name,
            content: input.content?.trim() || null,
            tag: "canvas",
            skill: [],
            skill_model: [],
        });
        return {
            project: normalizePlatformProject(result?.project),
            projects: normalizePlatformProjects(result?.projects),
        };
    },
    clearSession: async () => {
        const result = await postJson<{ ok: true }>("/api/platform/session/clear");
        clearPlatformSessionBinding();
        return result;
    },
    register: (username: string, password: string) => postJson<{ ok?: true } | null>("/api/platform/auth/register", { username, password }),
    login: async (username: string, password: string) => {
        const context = await postJson<PlatformContext>("/api/platform/auth/login", { username, password }, true);
        notifyPlatformSessionChange("login");
        return context;
    },
    getContext: () => platformRequest<PlatformContext>("/api/platform/context", undefined, true),
    listProjects: async () => normalizePlatformProjects(await platformRequest<unknown>("/api/platform/projects")),
    createProject: async (input: CreatePlatformProjectInput) => {
        const result = await postJson<unknown>("/api/platform/projects", {
            name: input.name,
            content: input.content?.trim() || null,
            tag: input.tag,
            skill: input.skill,
            skillModel: input.skillModel || [],
        });
        return result === null || result === undefined ? normalizePlatformProjects(await platformRequest<unknown>("/api/platform/projects")) : normalizePlatformProjects(result);
    },
    selectProject: async (projectId: string) => {
        const context = await postJson<PlatformContext>(`/api/platform/projects/${encodeURIComponent(projectId)}/select`, undefined, true);
        return context;
    },
    logout: async () => {
        const result = await postJson<{ ok: true }>("/api/platform/auth/logout");
        clearPlatformSessionBinding();
        notifyPlatformSessionChange("logout");
        return result;
    },
};
