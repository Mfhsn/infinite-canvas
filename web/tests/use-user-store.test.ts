import { afterEach, describe, expect, test } from "bun:test";

import type { PlatformContext } from "@/services/api/platform";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";
const { authenticatedUserState, useUserStore } = await import("@/stores/use-user-store");

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
    globalThis.fetch = originalFetch;
    setBrowserGlobals(originalWindow, originalLocalStorage);
});

describe("user store", () => {
    test("keeps session-scoped stores unhydrated until platform initialization", () => {
        expect(useCanvasStore.persist.getOptions().skipHydration).toBe(true);
        expect(useCanvasFolderStore.persist.getOptions().skipHydration).toBe(true);
        expect(useAssetStore.persist.getOptions().skipHydration).toBe(true);
    });

    test("maps platform context into isolated profile, permissions, points, and project state", () => {
        const context = platformContext();
        const state = authenticatedUserState(context);

        expect(state).toEqual({
            status: "authenticated",
            user: { id: "user-1", username: "alice", displayName: "Alice", avatarUrl: "" },
            profile: { uid: "user-1", username: "alice", nickname: "Alice" },
            permissionIds: [1, 7],
            currentPoints: 42,
            projectContext: { localProjectId: 9, externalProjectId: "external-9", sourceSystem: "platform", expiresAt: "2026-07-22T00:00:00Z" },
            error: null,
        });
        expect(state.permissionIds).not.toBe(context.permissionIds);
    });

    test("enters disabled mode only after the platform config resolves", async () => {
        globalThis.fetch = (async () => Response.json({ enabled: false })) as typeof fetch;
        await useUserStore.getState().initialize();

        expect(useUserStore.getState()).toMatchObject({ status: "disabled", profile: null, permissionIds: [], currentPoints: null, projectContext: null, error: null });
    });

    test("clears the canvas session and redirects when host-platform localStorage is missing", async () => {
        const redirects: string[] = [];
        installBrowserStorage({}, { location: { assign: (url: string) => redirects.push(url) } } as unknown as Window & typeof globalThis);
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const responses = [Response.json({ enabled: true }), Response.json({ ok: true })];
        globalThis.fetch = (async (input, init) => {
            calls.push({ input: String(input), init });
            return responses.shift()!;
        }) as typeof fetch;
        await useUserStore.getState().initialize();

        expect(useUserStore.getState()).toMatchObject({ status: "anonymous", profile: null, currentPoints: null });
        expect(calls.map((call) => call.input)).toEqual(["/api/platform/config", "/api/platform/session/clear"]);
        expect(calls[1]?.init?.method).toBe("POST");
        expect(redirects).toEqual(["/?login=true"]);
    });

    test("still redirects when stale canvas session cleanup fails", async () => {
        const redirects: string[] = [];
        installBrowserStorage({}, { location: { assign: (url: string) => redirects.push(url) } } as unknown as Window & typeof globalThis);
        const calls: string[] = [];
        const responses = [Response.json({ enabled: true }), Response.json({ error: { message: "Cleanup unavailable" } }, { status: 503 })];
        globalThis.fetch = (async (input) => {
            calls.push(String(input));
            return responses.shift()!;
        }) as typeof fetch;
        await useUserStore.getState().initialize();

        expect(useUserStore.getState()).toMatchObject({ status: "anonymous", profile: null, error: null });
        expect(calls).toEqual(["/api/platform/config", "/api/platform/session/clear"]);
        expect(redirects).toEqual(["/?login=true"]);
    });

    test("redirects to the platform login page when an authenticated session expires", () => {
        const redirects: string[] = [];
        installBrowserStorage({}, { location: { assign: (url: string) => redirects.push(url) } } as unknown as Window & typeof globalThis);
        useUserStore.setState(authenticatedUserState(platformContext()));

        useUserStore.getState().handleUnauthorized();

        expect(useUserStore.getState()).toMatchObject({ status: "anonymous", profile: null, error: null });
        expect(redirects).toEqual(["/?login=true"]);
    });

    test("bootstraps an authenticated canvas session from the host platform localStorage session", async () => {
        const context = platformContext();
        const storage = installBrowserStorage({
            "ai-comic-external-auth-session": JSON.stringify({ external_token: "host-token", refresh_token: "host-refresh" }),
            "ai-comic-current-project-id": "stale-project",
        });
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const responses = [Response.json({ enabled: true }), Response.json(context, { headers: { "X-Canvas-Session-Binding": "binding-1" } })];
        globalThis.fetch = (async (input, init) => {
            calls.push({ input: String(input), init });
            return responses.shift()!;
        }) as typeof fetch;

        await useUserStore.getState().initialize();

        expect(useUserStore.getState()).toMatchObject({
            status: "authenticated",
            profile: { uid: "user-1", username: "alice", nickname: "Alice" },
            currentPoints: 42,
            projectContext: { localProjectId: 9, externalProjectId: "external-9" },
        });
        expect(calls.map((call) => call.input)).toEqual(["/api/platform/config", "/api/platform/session/bootstrap"]);
        expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ externalToken: "host-token", refreshToken: "host-refresh", externalProjectId: "stale-project" });
        expect(storage.get("ai-comic-current-project-id")).toBe("external-9");
    });

    test("keeps canvas data unhydrated and requests a project when the host session has no project id", async () => {
        const storage = installBrowserStorage({
            "ai-comic-external-auth-session": JSON.stringify({ external_token: "host-token" }),
        });
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const responses = [Response.json({ enabled: true }), Response.json({ projects: [{ project_id: "project-one", name: "Project One", points: 12, permission_ids: [3] }] })];
        globalThis.fetch = (async (input, init) => {
            calls.push({ input: String(input), init });
            return responses.shift()!;
        }) as typeof fetch;

        await useUserStore.getState().initialize();

        expect(useUserStore.getState()).toMatchObject({
            status: "project_required",
            profile: null,
            projectContext: null,
            onboardingLoadStatus: "success",
            onboardingProjects: [{ projectId: "project-one", name: "Project One", points: 12, permissionIds: [3] }],
        });
        expect(storage.has("ai-comic-current-project-id")).toBe(false);
        expect(calls.map((call) => call.input)).toEqual(["/api/platform/config", "/api/platform/onboarding/projects/list"]);
        expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ externalToken: "host-token" });
    });

    test("falls back to the project picker when a persisted host project is no longer available", async () => {
        const storage = installBrowserStorage({
            "ai-comic-external-auth-session": JSON.stringify({ external_token: "host-token" }),
            "ai-comic-current-project-id": "removed-project",
        });
        const calls: string[] = [];
        const responses = [Response.json({ enabled: true }), Response.json({ error: { code: "platform_project_unavailable", message: "No accessible platform project is available" } }, { status: 403 }), Response.json({ projects: [] })];
        globalThis.fetch = (async (input) => {
            calls.push(String(input));
            return responses.shift()!;
        }) as typeof fetch;

        await useUserStore.getState().initialize();

        expect(calls).toEqual(["/api/platform/config", "/api/platform/session/bootstrap", "/api/platform/onboarding/projects/list"]);
        expect(storage.has("ai-comic-current-project-id")).toBe(false);
        expect(useUserStore.getState()).toMatchObject({
            status: "project_required",
            onboardingLoadStatus: "success",
            onboardingProjects: [],
        });
    });

    test("selects an onboarding project, persists it for the host platform, and then authenticates", async () => {
        const context = platformContext();
        const storage = installBrowserStorage({
            "ai-comic-external-auth-session": JSON.stringify({ external_token: "host-token", refresh_token: "host-refresh" }),
        });
        useUserStore.setState({
            status: "project_required",
            onboardingProjects: [{ projectId: "external-9", name: "Nine", points: 42, permissionIds: [1, 7] }],
            onboardingLoadStatus: "success",
            onboardingError: null,
        });
        let request: { input: string; init?: RequestInit } | undefined;
        globalThis.fetch = (async (input, init) => {
            request = { input: String(input), init };
            return Response.json(context, { headers: { "X-Canvas-Session-Binding": "binding-9" } });
        }) as typeof fetch;

        await useUserStore.getState().selectOnboardingProject("external-9");

        expect(request?.input).toBe("/api/platform/session/bootstrap");
        expect(JSON.parse(String(request?.init?.body))).toEqual({ externalToken: "host-token", refreshToken: "host-refresh", externalProjectId: "external-9" });
        expect(storage.get("ai-comic-current-project-id")).toBe("external-9");
        expect(useUserStore.getState()).toMatchObject({
            status: "authenticated",
            projectContext: { localProjectId: 9, externalProjectId: "external-9" },
            onboardingProjects: [],
            onboardingSelectingProjectId: null,
        });
    });

    test("keeps the project picker available when onboarding project lookup fails", async () => {
        installBrowserStorage({
            "ai-comic-external-auth-session": JSON.stringify({ external_token: "host-token" }),
        });
        const responses = [Response.json({ enabled: true }), Response.json({ error: { code: "integration_error", message: "Project service unavailable" } }, { status: 502 })];
        globalThis.fetch = (async () => responses.shift()!) as typeof fetch;

        await useUserStore.getState().initialize();

        expect(useUserStore.getState()).toMatchObject({
            status: "project_required",
            onboardingLoadStatus: "error",
            onboardingError: "Project service unavailable",
        });
    });

    test("refreshes user points from the current platform context and coalesces concurrent generation completions", async () => {
        const context = platformContext();
        useUserStore.setState(authenticatedUserState(context));
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            await Promise.resolve();
            return Response.json({ ...context, currentPoints: 31 });
        }) as typeof fetch;

        const [first, second] = await Promise.all([useUserStore.getState().refreshPoints(), useUserStore.getState().refreshPoints()]);

        expect(first).toBe(31);
        expect(second).toBe(31);
        expect(calls).toBe(1);
        expect(useUserStore.getState().currentPoints).toBe(31);
    });

    test("clears platform projects after logout", async () => {
        const { usePlatformProjectStore } = await import("@/stores/use-platform-project-store");
        const storage = installBrowserStorage({
            "ai-comic-external-auth-session": JSON.stringify({ external_token: "host-token" }),
            "ai-comic-integration-session": JSON.stringify({ local_token: "local-token" }),
            "ai-comic-current-project-id": "external-9",
            "ai-comic-current-user-id": "user-1",
        });
        usePlatformProjectStore.setState({ projects: [{ projectId: "one", name: "One", points: 1, permissionIds: [1] }], loadStatus: "success" });
        globalThis.fetch = (async () => Response.json({ ok: true })) as typeof fetch;

        await useUserStore.getState().logout();

        expect(usePlatformProjectStore.getState().projects).toEqual([]);
        expect(useUserStore.getState().status).toBe("initializing");
        expect(storage.size).toBe(0);
    });
});

function installBrowserStorage(entries: Record<string, string>, nextWindow: typeof globalThis.window = undefined as unknown as Window & typeof globalThis) {
    const values = new Map(Object.entries(entries));
    const storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => void values.delete(key),
        setItem: (key: string, value: string) => void values.set(key, String(value)),
    } satisfies Storage;
    setBrowserGlobals(nextWindow, storage);
    return values;
}

function setBrowserGlobals(nextWindow: typeof globalThis.window, nextStorage: typeof globalThis.localStorage) {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: nextWindow });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: nextStorage });
}

function platformContext(): PlatformContext {
    return {
        authenticated: true,
        uid: "user-1",
        username: "alice",
        nickname: "Alice",
        permissionIds: [1, 7],
        currentPoints: 42,
        localProjectId: 9,
        externalProjectId: "external-9",
        sourceSystem: "platform",
        expiresAt: "2026-07-22T00:00:00Z",
    };
}
