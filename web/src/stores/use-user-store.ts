import { create } from "zustand";

import { hydrateSessionData } from "@/stores/session-data-hydration";
import { platformApi, PlatformApiError, type CreateOnboardingProjectInput, type OnboardingProjectCreateResult, type PlatformContext, type PlatformProject } from "@/services/api/platform";
import { clearHostCurrentProjectId, clearHostPlatformSession, readHostPlatformSession, subscribeToHostPlatformSessionChanges, writeHostCurrentProjectId } from "@/services/host-platform-session";
import { clearPlatformSessionBinding, subscribeToPlatformSessionChanges } from "@/services/platform-session";
import { resetStorageRuntime } from "@/services/storage/runtime";
import { usePlatformProjectStore } from "@/stores/use-platform-project-store";
import { clearPersistedAiCredentials } from "@/stores/use-config-store";
import { redirectToPlatformLogin } from "@/lib/platform-navigation";

export type UserStatus = "disabled" | "initializing" | "project_required" | "anonymous" | "authenticated" | "error";
export type OnboardingProjectLoadStatus = "idle" | "loading" | "success" | "error";

export type LocalUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
};

export type UserProfile = Pick<PlatformContext, "uid" | "username" | "nickname">;
export type ProjectContext = Pick<PlatformContext, "localProjectId" | "externalProjectId" | "sourceSystem" | "expiresAt">;

export type AuthenticatedUserState = {
    status: "authenticated";
    user: LocalUser;
    profile: UserProfile;
    permissionIds: number[];
    currentPoints: number | null;
    projectContext: ProjectContext;
    error: null;
};

type UserStore = {
    status: UserStatus;
    user: LocalUser | null;
    profile: UserProfile | null;
    permissionIds: number[];
    currentPoints: number | null;
    projectContext: ProjectContext | null;
    error: string | null;
    onboardingProjects: PlatformProject[];
    onboardingLoadStatus: OnboardingProjectLoadStatus;
    onboardingCreating: boolean;
    onboardingSelectingProjectId: string | null;
    onboardingError: string | null;
    initialize: () => Promise<void>;
    loadOnboardingProjects: () => Promise<PlatformProject[]>;
    createOnboardingProject: (input: CreateOnboardingProjectInput) => Promise<OnboardingProjectCreateResult>;
    selectOnboardingProject: (projectId: string) => Promise<void>;
    refreshPoints: () => Promise<number | null>;
    logout: () => Promise<void>;
    handleUnauthorized: () => void;
};

let pointsRefreshPromise: Promise<number | null> | null = null;

const emptySessionState = {
    user: null,
    profile: null,
    permissionIds: [] as number[],
    currentPoints: null,
    projectContext: null,
    error: null,
};

type EmptyOnboardingState = {
    onboardingProjects: PlatformProject[];
    onboardingLoadStatus: OnboardingProjectLoadStatus;
    onboardingCreating: boolean;
    onboardingSelectingProjectId: string | null;
    onboardingError: string | null;
};

const emptyOnboardingState: EmptyOnboardingState = {
    onboardingProjects: [] as PlatformProject[],
    onboardingLoadStatus: "idle" as OnboardingProjectLoadStatus,
    onboardingCreating: false,
    onboardingSelectingProjectId: null,
    onboardingError: null,
};

export function authenticatedUserState(context: PlatformContext): AuthenticatedUserState {
    return {
        status: "authenticated",
        user: {
            id: context.uid,
            username: context.username,
            displayName: context.nickname || context.username,
            avatarUrl: "",
        },
        profile: { uid: context.uid, username: context.username, nickname: context.nickname },
        permissionIds: [...context.permissionIds],
        currentPoints: context.currentPoints,
        projectContext: {
            localProjectId: context.localProjectId,
            externalProjectId: context.externalProjectId,
            sourceSystem: context.sourceSystem,
            expiresAt: context.expiresAt,
        },
        error: null,
    };
}

export function platformContextFromUserState(state: { profile: UserProfile | null; permissionIds: number[]; currentPoints: number | null; projectContext: ProjectContext | null }): PlatformContext {
    if (!state.profile || !state.projectContext) throw new Error("Platform session context is incomplete");
    return {
        authenticated: true,
        uid: state.profile.uid,
        username: state.profile.username,
        nickname: state.profile.nickname,
        permissionIds: [...state.permissionIds],
        currentPoints: state.currentPoints,
        localProjectId: state.projectContext.localProjectId,
        externalProjectId: state.projectContext.externalProjectId,
        sourceSystem: state.projectContext.sourceSystem,
        expiresAt: state.projectContext.expiresAt,
    };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function initializationStageError(stage: string, error: unknown) {
    return new Error(`${stage}: ${errorMessage(error)}`, { cause: error });
}

function reloadPage() {
    if (typeof window !== "undefined") window.location.reload();
}

function resetSessionClientState(clearBinding = false) {
    if (clearBinding) clearPlatformSessionBinding();
    resetStorageRuntime();
}

async function clearCanvasSessionAndRedirect() {
    try {
        await platformApi.clearSession();
    } catch {
        // Redirect remains authoritative when stale-session cleanup is temporarily unavailable.
    }
    useUserStore.getState().handleUnauthorized();
}

function requireHostPlatformSession() {
    const hostSession = readHostPlatformSession();
    if (hostSession) return hostSession;
    useUserStore.getState().handleUnauthorized();
    throw new Error("Host platform session is unavailable");
}

async function hydrateAuthenticatedSession(context: PlatformContext) {
    if (!context.externalProjectId || context.localProjectId === null) {
        throw new Error("Platform project context is incomplete");
    }
    writeHostCurrentProjectId(context.externalProjectId);
    resetStorageRuntime();
    try {
        await hydrateSessionData();
    } catch (error) {
        throw initializationStageError("Canvas data loading", error);
    }
    return { ...authenticatedUserState(context), ...emptyOnboardingState };
}

function projectRequiredState(projects: PlatformProject[], overrides: Partial<typeof emptyOnboardingState> = {}) {
    return {
        status: "project_required" as const,
        ...emptySessionState,
        ...emptyOnboardingState,
        onboardingProjects: projects,
        onboardingLoadStatus: "success" as const,
        ...overrides,
    };
}

export const useUserStore = create<UserStore>()((set, get) => ({
    status: "initializing",
    ...emptySessionState,
    ...emptyOnboardingState,
    initialize: async () => {
        usePlatformProjectStore.getState().clear();
        set({ status: "initializing", ...emptySessionState, ...emptyOnboardingState });
        try {
            let config;
            try {
                config = await platformApi.getConfig();
            } catch (error) {
                throw initializationStageError("Platform configuration", error);
            }
            if (!config.enabled) {
                await hydrateSessionData();
                set({ status: "disabled", ...emptySessionState, ...emptyOnboardingState });
                return;
            }
            clearPersistedAiCredentials();
            const enterProjectRequired = async (externalToken: string) => {
                set(projectRequiredState([], { onboardingLoadStatus: "loading" }));
                try {
                    const projects = await platformApi.listOnboardingProjects(externalToken);
                    set(projectRequiredState(projects));
                } catch (error) {
                    if (error instanceof PlatformApiError && error.status === 401) {
                        get().handleUnauthorized();
                        return;
                    }
                    set(
                        projectRequiredState([], {
                            onboardingLoadStatus: "error",
                            onboardingError: errorMessage(error),
                        }),
                    );
                }
            };
            const hostSession = readHostPlatformSession();
            if (!hostSession) {
                await clearCanvasSessionAndRedirect();
                return;
            }
            if (!hostSession.externalProjectId) {
                await enterProjectRequired(hostSession.externalToken);
                return;
            }
            try {
                const context = await platformApi.bootstrapSession(hostSession);
                set(await hydrateAuthenticatedSession(context));
            } catch (error) {
                if (error instanceof PlatformApiError && error.status === 401) {
                    get().handleUnauthorized();
                    return;
                }
                if (error instanceof PlatformApiError && error.code === "platform_project_unavailable") {
                    clearHostCurrentProjectId();
                    await enterProjectRequired(hostSession.externalToken);
                    return;
                }
                if (error instanceof Error && error.message.startsWith("Canvas data loading:")) throw error;
                throw initializationStageError("Platform session bootstrap", error);
            }
        } catch (error) {
            set({ status: "error", ...emptySessionState, ...emptyOnboardingState, error: errorMessage(error) });
        }
    },
    loadOnboardingProjects: async () => {
        const hostSession = requireHostPlatformSession();
        set((state) => ({
            status: "project_required",
            onboardingLoadStatus: "loading",
            onboardingError: null,
            onboardingProjects: state.onboardingProjects,
        }));
        try {
            const projects = await platformApi.listOnboardingProjects(hostSession.externalToken);
            set(projectRequiredState(projects));
            return projects;
        } catch (error) {
            if (error instanceof PlatformApiError && error.status === 401) get().handleUnauthorized();
            else
                set((state) => ({
                    status: "project_required",
                    onboardingLoadStatus: "error",
                    onboardingError: errorMessage(error),
                    onboardingProjects: state.onboardingProjects,
                }));
            throw error;
        }
    },
    createOnboardingProject: async (input) => {
        const hostSession = requireHostPlatformSession();
        set({ status: "project_required", onboardingCreating: true, onboardingError: null });
        try {
            const result = await platformApi.createOnboardingProject(hostSession.externalToken, input);
            set(projectRequiredState(result.projects));
            return result;
        } catch (error) {
            if (error instanceof PlatformApiError && error.status === 401) get().handleUnauthorized();
            else set({ status: "project_required", onboardingCreating: false, onboardingError: errorMessage(error) });
            throw error;
        }
    },
    selectOnboardingProject: async (projectId) => {
        const hostSession = requireHostPlatformSession();
        set({ status: "project_required", onboardingSelectingProjectId: projectId, onboardingError: null });
        try {
            const context = await platformApi.bootstrapSession({ ...hostSession, externalProjectId: projectId });
            if (context.externalProjectId !== projectId) throw new Error("Platform selected a different project");
            set(await hydrateAuthenticatedSession(context));
        } catch (error) {
            if (error instanceof PlatformApiError && error.status === 401) get().handleUnauthorized();
            else {
                resetStorageRuntime();
                set({
                    status: "project_required",
                    ...emptySessionState,
                    onboardingSelectingProjectId: null,
                    onboardingError: errorMessage(error),
                });
            }
            throw error;
        }
    },
    refreshPoints: async () => {
        const snapshot = get();
        if (snapshot.status !== "authenticated" || !snapshot.profile || !snapshot.projectContext) return snapshot.currentPoints;
        if (pointsRefreshPromise) return pointsRefreshPromise;
        const expectedUid = snapshot.profile.uid;
        const expectedSourceSystem = snapshot.projectContext.sourceSystem;
        const expectedLocalProjectId = snapshot.projectContext.localProjectId;
        pointsRefreshPromise = platformApi
            .getContext()
            .then((context) => {
                const current = get();
                if (current.status === "authenticated" && current.profile?.uid === expectedUid && current.projectContext?.sourceSystem === expectedSourceSystem && current.projectContext?.localProjectId === expectedLocalProjectId) {
                    set({ currentPoints: context.currentPoints });
                }
                return context.currentPoints;
            })
            .catch((error) => {
                if (error instanceof PlatformApiError && error.status === 401) get().handleUnauthorized();
                throw error;
            })
            .finally(() => {
                pointsRefreshPromise = null;
            });
        return pointsRefreshPromise;
    },
    logout: async () => {
        await platformApi.logout();
        clearHostPlatformSession();
        usePlatformProjectStore.getState().clear();
        set({ status: "initializing", ...emptySessionState, ...emptyOnboardingState });
        resetSessionClientState(true);
        reloadPage();
    },
    handleUnauthorized: () => {
        usePlatformProjectStore.getState().clear();
        resetSessionClientState(true);
        set({ status: "anonymous", ...emptySessionState, ...emptyOnboardingState });
        redirectToPlatformLogin();
    },
}));

subscribeToPlatformSessionChanges(() => {
    usePlatformProjectStore.getState().clear();
    useUserStore.setState({ status: "initializing", ...emptySessionState, ...emptyOnboardingState });
    resetSessionClientState(true);
    reloadPage();
});

subscribeToHostPlatformSessionChanges(() => {
    if (!readHostPlatformSession()) {
        void clearCanvasSessionAndRedirect();
        return;
    }
    usePlatformProjectStore.getState().clear();
    useUserStore.setState({ status: "initializing", ...emptySessionState, ...emptyOnboardingState });
    resetSessionClientState(true);
    reloadPage();
});
