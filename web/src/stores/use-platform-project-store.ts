import { create } from "zustand";

import { platformApi, PlatformApiError, type CreatePlatformProjectInput, type PlatformContext, type PlatformProject } from "@/services/api/platform";
import { appPath } from "@/lib/app-base-path";
import { abortWorkspaceSwitch, beginWorkspaceSwitch, completeWorkspaceSwitch } from "@/lib/localforage-storage";
import { writeHostCurrentProjectId } from "@/services/host-platform-session";
import { notifyPlatformSessionChange, subscribeToPlatformSessionChanges } from "@/services/platform-session";
import { resetStorageRuntime } from "@/services/storage/runtime";
import { flushSessionData, hydrateSessionData } from "@/stores/session-data-hydration";

type ProjectLoadStatus = "idle" | "loading" | "success" | "error";

type PlatformProjectStore = {
    projects: PlatformProject[];
    loadStatus: ProjectLoadStatus;
    creating: boolean;
    selectingProjectId: string | null;
    error: string | null;
    loadProjects: () => Promise<PlatformProject[]>;
    createProject: (input: CreatePlatformProjectInput) => Promise<PlatformProject[]>;
    selectProject: (projectId: string) => Promise<PlatformContext>;
    clear: () => void;
};

const initialState = {
    projects: [] as PlatformProject[],
    loadStatus: "idle" as ProjectLoadStatus,
    creating: false,
    selectingProjectId: null,
    error: null,
};

let operationVersion = 0;
let projectRequestSequence = 0;
let createRequestSequence = 0;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

async function handleUnauthorized(error: unknown) {
    if (!(error instanceof PlatformApiError) || error.status !== 401) return false;
    const { useUserStore } = await import("@/stores/use-user-store");
    useUserStore.getState().handleUnauthorized();
    return true;
}

export function parsePlatformProjectSkillIds(value: string) {
    const ids = value
        .split(/[,，\s]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isSafeInteger(item) && item >= 0);
    return [...new Set(ids)];
}

export async function runPlatformProjectSelectionTransaction(
    projectId: string,
    previousProjectId: string | null,
    dependencies: {
        beginSwitch: () => void;
        completeSwitch: () => void;
        abortSwitch: () => void;
        flush: () => Promise<void>;
        select: (projectId: string) => Promise<PlatformContext>;
        resetStorage: () => void;
        hydrate: () => Promise<void>;
        handoff?: (context: PlatformContext) => boolean;
        onSelected?: () => void;
        onRolledBack?: () => void;
    } = {
        beginSwitch: beginWorkspaceSwitch,
        completeSwitch: completeWorkspaceSwitch,
        abortSwitch: abortWorkspaceSwitch,
        flush: flushSessionData,
        select: platformApi.selectProject,
        resetStorage: resetStorageRuntime,
        hydrate: hydrateSessionData,
        handoff: reloadWorkspaceAfterSwitch,
    },
) {
    dependencies.beginSwitch();
    let selected = false;
    let handedOff = false;
    try {
        await dependencies.flush();
        const context = await dependencies.select(projectId);
        selected = true;
        dependencies.onSelected?.();
        dependencies.resetStorage();
        try {
            await dependencies.hydrate();
            handedOff = dependencies.handoff?.(context) ?? false;
            return context;
        } catch (error) {
            if (!previousProjectId) {
                handedOff = dependencies.handoff?.(context) ?? false;
                throw error;
            }
            try {
                await dependencies.select(previousProjectId);
                dependencies.resetStorage();
                await dependencies.hydrate();
                dependencies.onRolledBack?.();
            } catch (rollbackError) {
                handedOff = dependencies.handoff?.(context) ?? false;
                throw rollbackError;
            }
            throw error;
        }
    } finally {
        if (!handedOff) {
            if (selected) dependencies.completeSwitch();
            else dependencies.abortSwitch();
        }
    }
}

function reloadWorkspaceAfterSwitch() {
    if (typeof window === "undefined") return false;
    window.location.replace(appPath("canvas"));
    return true;
}

export const usePlatformProjectStore = create<PlatformProjectStore>()((set) => ({
    ...initialState,
    loadProjects: async () => {
        const version = operationVersion;
        const requestId = ++projectRequestSequence;
        set({ loadStatus: "loading", error: null });
        try {
            const projects = await platformApi.listProjects();
            if (version === operationVersion && requestId === projectRequestSequence) set({ projects, loadStatus: "success", error: null });
            return projects;
        } catch (error) {
            if (await handleUnauthorized(error)) return [];
            if (version === operationVersion && requestId === projectRequestSequence) set({ loadStatus: "error", error: errorMessage(error) });
            throw error;
        }
    },
    createProject: async (input) => {
        const version = operationVersion;
        const requestId = ++projectRequestSequence;
        const createRequestId = ++createRequestSequence;
        set({ creating: true, error: null });
        try {
            const projects = await platformApi.createProject(input);
            if (version === operationVersion && requestId === projectRequestSequence) set({ projects, loadStatus: "success", creating: false, error: null });
            else if (version === operationVersion && createRequestId === createRequestSequence) set({ creating: false });
            return projects;
        } catch (error) {
            if (await handleUnauthorized(error)) throw error;
            if (version === operationVersion && requestId === projectRequestSequence) set({ creating: false, error: errorMessage(error) });
            else if (version === operationVersion && createRequestId === createRequestSequence) set({ creating: false });
            throw error;
        }
    },
    selectProject: async (projectId) => {
        const currentUserModule = await import("@/stores/use-user-store");
        const userStore = currentUserModule.useUserStore;
        const userState = userStore.getState();
        if (userState.status !== "authenticated") throw new Error("Platform session is not authenticated");
        if (userState.projectContext?.externalProjectId === projectId) return currentUserModule.platformContextFromUserState(userState);
        const previousContext = currentUserModule.platformContextFromUserState(userState);

        const version = operationVersion;
        let exchanged = false;
        let rolledBack = false;
        set({ selectingProjectId: projectId, error: null });
        userStore.setState({ status: "initializing", error: null });
        try {
            const context = await runPlatformProjectSelectionTransaction(projectId, previousContext.externalProjectId, {
                beginSwitch: beginWorkspaceSwitch,
                completeSwitch: completeWorkspaceSwitch,
                abortSwitch: abortWorkspaceSwitch,
                flush: flushSessionData,
                select: platformApi.selectProject,
                resetStorage: resetStorageRuntime,
                hydrate: hydrateSessionData,
                handoff: reloadWorkspaceAfterSwitch,
                onSelected: () => {
                    exchanged = true;
                    writeHostCurrentProjectId(projectId);
                    notifyPlatformSessionChange("exchange");
                },
                onRolledBack: () => {
                    rolledBack = true;
                    if (previousContext.externalProjectId) writeHostCurrentProjectId(previousContext.externalProjectId);
                    notifyPlatformSessionChange("exchange");
                },
            });
            if (version !== operationVersion) return context;
            userStore.setState(currentUserModule.authenticatedUserState(context));
            set((state) => ({
                selectingProjectId: null,
                error: null,
                projects: state.projects.map((project) =>
                    project.projectId === context.externalProjectId ? { ...project, points: context.currentPoints, permissionIds: [...context.permissionIds] } : project,
                ),
            }));
            return context;
        } catch (error) {
            if (await handleUnauthorized(error)) throw error;
            if (version === operationVersion) set({ selectingProjectId: null, error: errorMessage(error) });
            if (rolledBack) userStore.setState(currentUserModule.authenticatedUserState(previousContext));
            else if (exchanged) userStore.setState({ status: "error", error: errorMessage(error) });
            else userStore.setState({ status: "authenticated", error: null });
            throw error;
        }
    },
    clear: () => {
        operationVersion += 1;
        projectRequestSequence += 1;
        createRequestSequence += 1;
        set({ ...initialState });
    },
}));

subscribeToPlatformSessionChanges(() => {
    usePlatformProjectStore.getState().clear();
});
