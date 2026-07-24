import { create } from "zustand";

import { hydrateSessionData } from "@/stores/session-data-hydration";
import { platformApi, PlatformApiError, type PlatformContext } from "@/services/api/platform";
import { clearHostPlatformSession, readHostPlatformSession, subscribeToHostPlatformSessionChanges, writeHostCurrentProjectId } from "@/services/host-platform-session";
import { clearPlatformSessionBinding, subscribeToPlatformSessionChanges } from "@/services/platform-session";
import { resetStorageRuntime } from "@/services/storage/runtime";
import { usePlatformProjectStore } from "@/stores/use-platform-project-store";
import { clearPersistedAiCredentials } from "@/stores/use-config-store";

export type UserStatus = "disabled" | "initializing" | "anonymous" | "authenticated" | "error";

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
    initialize: () => Promise<void>;
    logout: () => Promise<void>;
    handleUnauthorized: () => void;
};

const emptySessionState = {
    user: null,
    profile: null,
    permissionIds: [] as number[],
    currentPoints: null,
    projectContext: null,
    error: null,
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

export const useUserStore = create<UserStore>()((set, get) => ({
    status: "initializing",
    ...emptySessionState,
    initialize: async () => {
        usePlatformProjectStore.getState().clear();
        set({ status: "initializing", ...emptySessionState });
        try {
            let config;
            try {
                config = await platformApi.getConfig();
            } catch (error) {
                throw initializationStageError("Platform configuration", error);
            }
            if (!config.enabled) {
                await hydrateSessionData();
                set({ status: "disabled", ...emptySessionState });
                return;
            }
            clearPersistedAiCredentials();
            const hostSession = readHostPlatformSession();
            if (!hostSession) {
                await platformApi.clearSession().catch(() => undefined);
                get().handleUnauthorized();
                return;
            }
            try {
                const context = await platformApi.bootstrapSession(hostSession);
                if (context.externalProjectId) writeHostCurrentProjectId(context.externalProjectId);
                try {
                    await hydrateSessionData();
                } catch (error) {
                    throw initializationStageError("Canvas data loading", error);
                }
                set(authenticatedUserState(context));
            } catch (error) {
                if (error instanceof PlatformApiError && error.status === 401) {
                    get().handleUnauthorized();
                    return;
                }
                if (error instanceof Error && error.message.startsWith("Canvas data loading:")) throw error;
                throw initializationStageError("Platform session bootstrap", error);
            }
        } catch (error) {
            set({ status: "error", ...emptySessionState, error: errorMessage(error) });
        }
    },
    logout: async () => {
        await platformApi.logout();
        clearHostPlatformSession();
        usePlatformProjectStore.getState().clear();
        set({ status: "initializing", ...emptySessionState });
        resetSessionClientState(true);
        reloadPage();
    },
    handleUnauthorized: () => {
        usePlatformProjectStore.getState().clear();
        resetSessionClientState(true);
        set({ status: "anonymous", ...emptySessionState });
    },
}));

subscribeToPlatformSessionChanges(() => {
    usePlatformProjectStore.getState().clear();
    useUserStore.setState({ status: "initializing", ...emptySessionState });
    resetSessionClientState(true);
    reloadPage();
});

subscribeToHostPlatformSessionChanges(() => {
    usePlatformProjectStore.getState().clear();
    useUserStore.setState({ status: "initializing", ...emptySessionState });
    resetSessionClientState(true);
    reloadPage();
});
