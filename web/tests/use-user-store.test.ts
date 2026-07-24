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

    test("treats a missing host-platform login session as anonymous", async () => {
        installBrowserStorage({});
        const responses = [Response.json({ enabled: true }), Response.json({ ok: true })];
        globalThis.fetch = (async () => responses.shift()!) as typeof fetch;
        await useUserStore.getState().initialize();

        expect(useUserStore.getState()).toMatchObject({ status: "anonymous", profile: null, error: null });
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

function installBrowserStorage(entries: Record<string, string>) {
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
    setBrowserGlobals(undefined as unknown as Window & typeof globalThis, storage);
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
