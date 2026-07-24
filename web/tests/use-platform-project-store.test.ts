import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getWorkspaceWriteGateState, resetWorkspaceWriteGateForTests } from "@/lib/localforage-storage";
import type { PlatformContext } from "@/services/api/platform";
import { parsePlatformProjectSkillIds, runPlatformProjectSelectionTransaction, usePlatformProjectStore } from "@/stores/use-platform-project-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasFolderStore } from "@/stores/canvas/use-canvas-folder-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

(globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = "test";
const { authenticatedUserState, useUserStore } = await import("@/stores/use-user-store");

const originalFetch = globalThis.fetch;

beforeEach(() => {
    resetWorkspaceWriteGateForTests();
    usePlatformProjectStore.getState().clear();
    useUserStore.setState(authenticatedUserState(platformContext()));
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("platform project store", () => {
    test("parses unique safe skill ids", () => {
        expect(parsePlatformProjectSkillIds("0, 2，2 invalid -1 3.5 4")).toEqual([0, 2, 4]);
    });

    test("loads projects and adopts the server-refreshed list after create", async () => {
        const calls: string[] = [];
        const responses = [
            Response.json({ projects: [{ projectId: "one", name: "One", points: 1, permissionIds: [1] }] }),
            Response.json({ projects: [{ projectId: "one", name: "One", points: 1, permissionIds: [1] }, { projectId: "two", name: "Two", points: 2, permissionIds: [2] }] }),
        ];
        globalThis.fetch = (async (input) => {
            calls.push(String(input));
            return responses.shift()!;
        }) as typeof fetch;

        await usePlatformProjectStore.getState().loadProjects();
        await usePlatformProjectStore.getState().createProject({ name: "Two", tag: "tag", skill: [0] });

        expect(calls).toEqual(["/api/platform/projects", "/api/platform/projects"]);
        expect(usePlatformProjectStore.getState()).toMatchObject({ loadStatus: "success", creating: false, error: null });
        expect(usePlatformProjectStore.getState().projects.map((project) => project.projectId)).toEqual(["one", "two"]);
    });

    test("runs selection in flush, exchange, reset, hydrate order", async () => {
        const order: string[] = [];
        const context = platformContext({ externalProjectId: "two", localProjectId: 2 });
        const result = await runPlatformProjectSelectionTransaction("two", "one", {
            beginSwitch: () => void order.push("begin"),
            completeSwitch: () => void order.push("complete"),
            abortSwitch: () => void order.push("abort"),
            flush: async () => void order.push("flush"),
            select: async (projectId) => {
                order.push(`select:${projectId}`);
                return context;
            },
            resetStorage: () => void order.push("reset"),
            hydrate: async () => void order.push("hydrate"),
            onSelected: () => void order.push("selected"),
        });

        expect(result).toBe(context);
        expect(order).toEqual(["begin", "flush", "select:two", "selected", "reset", "hydrate", "complete"]);
    });

    test("rolls the server session and storage back when target hydration fails", async () => {
        const order: string[] = [];
        let hydrationCount = 0;
        let rolledBack = false;

        await expect(
            runPlatformProjectSelectionTransaction("two", "one", {
                beginSwitch: () => void order.push("begin"),
                completeSwitch: () => void order.push("complete"),
                abortSwitch: () => void order.push("abort"),
                flush: async () => void order.push("flush"),
                select: async (projectId) => {
                    order.push(`select:${projectId}`);
                    return platformContext({ externalProjectId: projectId, localProjectId: projectId === "two" ? 2 : 1 });
                },
                resetStorage: () => void order.push("reset"),
                hydrate: async () => {
                    hydrationCount += 1;
                    order.push(`hydrate:${hydrationCount}`);
                    if (hydrationCount === 1) throw new Error("Target hydration failed");
                },
                onRolledBack: () => {
                    rolledBack = true;
                    order.push("rolled-back");
                },
            }),
        ).rejects.toThrow("Target hydration failed");

        expect(rolledBack).toBe(true);
        expect(order).toEqual(["begin", "flush", "select:two", "reset", "hydrate:1", "select:one", "reset", "hydrate:2", "rolled-back", "complete"]);
    });

    test("always completes the write gate exactly once when compensation is unavailable or fails", async () => {
        for (const scenario of ["missing-previous", "rollback-fails"] as const) {
            let completes = 0;
            await expect(
                runPlatformProjectSelectionTransaction("two", scenario === "missing-previous" ? null : "one", {
                    beginSwitch: () => undefined,
                    completeSwitch: () => {
                        completes += 1;
                    },
                    abortSwitch: () => undefined,
                    flush: async () => undefined,
                    select: async (projectId) => {
                        if (projectId === "one") throw new Error("Rollback failed");
                        return platformContext({ externalProjectId: projectId });
                    },
                    resetStorage: () => undefined,
                    hydrate: async () => {
                        throw new Error("Target hydration failed");
                    },
                }),
            ).rejects.toThrow(scenario === "missing-previous" ? "Target hydration failed" : "Rollback failed");
            expect(completes).toBe(1);
        }
    });

    test("aborts without advancing the workspace epoch when the old workspace flush fails", async () => {
        const order: string[] = [];
        await expect(
            runPlatformProjectSelectionTransaction("two", "one", {
                beginSwitch: () => void order.push("begin"),
                completeSwitch: () => void order.push("complete"),
                abortSwitch: () => void order.push("abort"),
                flush: async () => {
                    order.push("flush");
                    throw new Error("Old workspace flush failed");
                },
                select: async () => platformContext({ externalProjectId: "two" }),
                resetStorage: () => void order.push("reset"),
                hydrate: async () => void order.push("hydrate"),
            }),
        ).rejects.toThrow("Old workspace flush failed");

        expect(order).toEqual(["begin", "flush", "abort"]);
    });

    test("keeps writes paused when a successful switch hands off to a fresh page", async () => {
        const order: string[] = [];
        await runPlatformProjectSelectionTransaction("two", "one", {
            beginSwitch: () => void order.push("begin"),
            completeSwitch: () => void order.push("complete"),
            abortSwitch: () => void order.push("abort"),
            flush: async () => void order.push("flush"),
            select: async () => {
                order.push("select");
                return platformContext({ externalProjectId: "two" });
            },
            resetStorage: () => void order.push("reset"),
            hydrate: async () => void order.push("hydrate"),
            handoff: () => (order.push("handoff"), true),
        });

        expect(order).toEqual(["begin", "flush", "select", "reset", "hydrate", "handoff"]);
    });

    test("keeps writes paused and hands off when compensation cannot restore the old workspace", async () => {
        const order: string[] = [];
        await expect(
            runPlatformProjectSelectionTransaction("two", "one", {
                beginSwitch: () => void order.push("begin"),
                completeSwitch: () => void order.push("complete"),
                abortSwitch: () => void order.push("abort"),
                flush: async () => void order.push("flush"),
                select: async (projectId) => {
                    order.push(`select:${projectId}`);
                    if (projectId === "one") throw new Error("Rollback failed");
                    return platformContext({ externalProjectId: "two" });
                },
                resetStorage: () => void order.push("reset"),
                hydrate: async () => {
                    order.push("hydrate");
                    throw new Error("Target hydration failed");
                },
                handoff: () => (order.push("handoff"), true),
            }),
        ).rejects.toThrow("Rollback failed");

        expect(order).toEqual(["begin", "flush", "select:two", "reset", "hydrate", "select:one", "handoff"]);
    });

    test("restores authenticated state when project selection fails before exchange", async () => {
        globalThis.fetch = (async () => Response.json({ error: { message: "Project unavailable" } }, { status: 404 })) as typeof fetch;

        await expect(usePlatformProjectStore.getState().selectProject("missing")).rejects.toThrow("Project unavailable");
        expect(useUserStore.getState().status).toBe("authenticated");
        expect(useUserStore.getState().projectContext?.externalProjectId).toBe("one");
        expect(usePlatformProjectStore.getState()).toMatchObject({ selectingProjectId: null, error: "Project unavailable" });
    });

    test("updates authenticated context only after successful selection hydration", async () => {
        let resolveResponse: ((response: Response) => void) | undefined;
        let markFetchStarted: (() => void) | undefined;
        const fetchStarted = new Promise<void>((resolve) => (markFetchStarted = resolve));
        globalThis.fetch = (() => {
            markFetchStarted?.();
            return new Promise<Response>((resolve) => (resolveResponse = resolve));
        }) as typeof fetch;

        const selection = usePlatformProjectStore.getState().selectProject("two");
        await fetchStarted;
        expect(useUserStore.getState().status).toBe("initializing");
        resolveResponse?.(Response.json(platformContext({ externalProjectId: "two", localProjectId: 2, currentPoints: 22 })));
        await selection;

        expect(useUserStore.getState()).toMatchObject({ status: "authenticated", currentPoints: 22, projectContext: { externalProjectId: "two", localProjectId: 2 } });
        expect(usePlatformProjectStore.getState().selectingProjectId).toBeNull();
    });

    test("restores the original authenticated context after hydration compensation", async () => {
        const calls: string[] = [];
        const responses = [platformContext({ externalProjectId: "two", localProjectId: 2 }), platformContext()];
        globalThis.fetch = (async (input) => {
            calls.push(String(input));
            return Response.json(responses.shift());
        }) as typeof fetch;
        const canvasRehydrate = useCanvasStore.persist.rehydrate;
        const folderRehydrate = useCanvasFolderStore.persist.rehydrate;
        const assetRehydrate = useAssetStore.persist.rehydrate;
        let hydrationCount = 0;
        useCanvasStore.persist.rehydrate = async () => {
            hydrationCount += 1;
            if (hydrationCount === 1) throw new Error("Target hydration failed");
        };
        useCanvasFolderStore.persist.rehydrate = async () => undefined;
        useAssetStore.persist.rehydrate = async () => undefined;

        try {
            await expect(usePlatformProjectStore.getState().selectProject("two")).rejects.toThrow("Target hydration failed");
        } finally {
            useCanvasStore.persist.rehydrate = canvasRehydrate;
            useCanvasFolderStore.persist.rehydrate = folderRehydrate;
            useAssetStore.persist.rehydrate = assetRehydrate;
        }

        expect(calls).toEqual(["/api/platform/projects/two/select", "/api/platform/projects/one/select"]);
        expect(useUserStore.getState()).toMatchObject({ status: "authenticated", currentPoints: 10, projectContext: { externalProjectId: "one", localProjectId: 1 } });
        expect(usePlatformProjectStore.getState()).toMatchObject({ selectingProjectId: null, error: "Target hydration failed" });
        expect(getWorkspaceWriteGateState()).toEqual({ epoch: 1, paused: false });
    });

    test("ignores a late project load response after a newer load", async () => {
        const first = deferredResponse();
        const second = deferredResponse();
        globalThis.fetch = (async () => (first.used ? second.promise : ((first.used = true), first.promise))) as typeof fetch;

        const olderLoad = usePlatformProjectStore.getState().loadProjects();
        const newerLoad = usePlatformProjectStore.getState().loadProjects();
        second.resolve(Response.json({ projects: [{ projectId: "new", name: "New", points: 2, permissionIds: [] }] }));
        await newerLoad;
        first.resolve(Response.json({ projects: [{ projectId: "old", name: "Old", points: 1, permissionIds: [] }] }));
        await olderLoad;

        expect(usePlatformProjectStore.getState().projects.map((project) => project.projectId)).toEqual(["new"]);
    });

    test("ignores a late create response after a newer load without leaving creation busy", async () => {
        const create = deferredResponse();
        const load = deferredResponse();
        globalThis.fetch = (async () => (create.used ? load.promise : ((create.used = true), create.promise))) as typeof fetch;

        const olderCreate = usePlatformProjectStore.getState().createProject({ name: "Old create", tag: "tag", skill: [0] });
        const newerLoad = usePlatformProjectStore.getState().loadProjects();
        load.resolve(Response.json({ projects: [{ projectId: "new", name: "New", points: 2, permissionIds: [] }] }));
        await newerLoad;
        create.resolve(Response.json({ projects: [{ projectId: "old", name: "Old", points: 1, permissionIds: [] }] }));
        await olderCreate;

        expect(usePlatformProjectStore.getState()).toMatchObject({ creating: false, projects: [{ projectId: "new" }] });
    });

    test("clears projects and user session on a project API 401", async () => {
        usePlatformProjectStore.setState({ projects: [{ projectId: "one", name: "One", points: 1, permissionIds: [1] }], loadStatus: "success" });
        globalThis.fetch = (async () => Response.json({ error: { message: "Unauthorized" } }, { status: 401 })) as typeof fetch;

        expect(await usePlatformProjectStore.getState().loadProjects()).toEqual([]);
        expect(usePlatformProjectStore.getState().projects).toEqual([]);
        expect(useUserStore.getState().status).toBe("anonymous");
    });

    test("does not report project creation success after a 401 invalidates the session", async () => {
        globalThis.fetch = (async () => Response.json({ error: { message: "Unauthorized" } }, { status: 401 })) as typeof fetch;

        await expect(usePlatformProjectStore.getState().createProject({ name: "Two", tag: "tag", skill: [0] })).rejects.toThrow("Unauthorized");
        expect(usePlatformProjectStore.getState().projects).toEqual([]);
        expect(useUserStore.getState().status).toBe("anonymous");
    });
});

function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((next) => {
        resolve = next;
    });
    return { promise, resolve, used: false };
}

function platformContext(overrides: Partial<PlatformContext> = {}): PlatformContext {
    return {
        authenticated: true,
        uid: "user-1",
        username: "alice",
        nickname: "Alice",
        permissionIds: [1, 7],
        currentPoints: 10,
        localProjectId: 1,
        externalProjectId: "one",
        sourceSystem: "platform",
        expiresAt: "2026-07-23T00:00:00Z",
        ...overrides,
    };
}
