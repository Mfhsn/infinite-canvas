import { afterEach, describe, expect, test } from "bun:test";

import { normalizePlatformProjects, platformApi, PlatformApiError, type PlatformContext } from "@/services/api/platform";
import { CANVAS_SESSION_BINDING_HEADER, clearPlatformSessionBinding, getPlatformSessionBinding, hasPlatformSessionBinding } from "@/services/platform-session";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    clearPlatformSessionBinding();
});

describe("platform API client", () => {
    test("bootstraps the server session from the host-platform token and current project", async () => {
        let request: { input: string; init?: RequestInit } | undefined;
        const context = platformContext();
        globalThis.fetch = (async (input, init) => {
            request = { input: String(input), init };
            return Response.json(context, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "host-binding" } });
        }) as typeof fetch;

        expect(await platformApi.bootstrapSession({ externalToken: "host-token", refreshToken: "host-refresh", externalProjectId: "project-4" })).toEqual(context);
        expect(request?.input).toBe("/api/platform/session/bootstrap");
        expect(request?.init?.credentials).toBe("include");
        expect(request?.init?.method).toBe("POST");
        expect(JSON.parse(String(request?.init?.body))).toEqual({ externalToken: "host-token", refreshToken: "host-refresh", externalProjectId: "project-4" });
        expect(getPlatformSessionBinding()).toBe("host-binding");
    });

    test("bootstraps a projectless server session without inventing a project id", async () => {
        let request: { input: string; init?: RequestInit } | undefined;
        const context: PlatformContext = { ...platformContext(), localProjectId: null, externalProjectId: null };
        globalThis.fetch = (async (input, init) => {
            request = { input: String(input), init };
            return Response.json(context, { headers: { [CANVAS_SESSION_BINDING_HEADER]: "projectless-binding" } });
        }) as typeof fetch;

        expect(await platformApi.bootstrapSession({ externalToken: "host-token", refreshToken: null, externalProjectId: null })).toEqual(context);
        expect(JSON.parse(String(request?.init?.body))).toEqual({ externalToken: "host-token", refreshToken: null, externalProjectId: null });
        expect(getPlatformSessionBinding()).toBe("projectless-binding");
    });

    test("lists and creates onboarding projects with the fixed empty-skill contract", async () => {
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const responses = [
            Response.json({ projects: [{ project_id: "one", name: "One", points: 1, permission_ids: [2] }] }),
            Response.json({
                project: { project_id: "created", name: "Canvas project", points: 0, permission_ids: [] },
                projects: [
                    { project_id: "one", name: "One" },
                    { project_id: "created", name: "Canvas project" },
                ],
            }),
        ];
        globalThis.fetch = (async (input, init) => {
            calls.push({ input: String(input), init });
            return responses.shift()!;
        }) as typeof fetch;

        expect(await platformApi.listOnboardingProjects("host-token")).toEqual([{ projectId: "one", name: "One", points: 1, permissionIds: [2] }]);
        expect(await platformApi.createOnboardingProject("host-token", { name: "Canvas project", content: " Brief " })).toEqual({
            project: { projectId: "created", name: "Canvas project", points: 0, permissionIds: [] },
            projects: [
                { projectId: "one", name: "One", points: null, permissionIds: [] },
                { projectId: "created", name: "Canvas project", points: null, permissionIds: [] },
            ],
        });
        expect(calls.map((call) => call.input)).toEqual(["/api/platform/onboarding/projects/list", "/api/platform/onboarding/projects/create"]);
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ externalToken: "host-token" });
        expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
            externalToken: "host-token",
            name: "Canvas project",
            content: "Brief",
            tag: "canvas",
            skill: [],
            skill_model: [],
        });
    });

    test("uses same-origin cookie credentials and JSON for login", async () => {
        let request: { input: string; init?: RequestInit } | undefined;
        const context = platformContext();
        globalThis.fetch = (async (input, init) => {
            request = { input: String(input), init };
            return Response.json(context);
        }) as typeof fetch;

        expect(await platformApi.login("alice", "secret")).toEqual(context);
        expect(request?.input).toBe("/api/platform/auth/login");
        expect(request?.init?.credentials).toBe("include");
        expect(request?.init?.method).toBe("POST");
        expect(new Headers(request?.init?.headers).get("Accept")).toBe("application/json");
        expect(new Headers(request?.init?.headers).get("Content-Type")).toBe("application/json");
        expect(JSON.parse(String(request?.init?.body))).toEqual({ username: "alice", password: "secret" });
    });

    test("registers without sending owner, password confirmation, or tokens", async () => {
        let request: { input: string; init?: RequestInit } | undefined;
        globalThis.fetch = (async (input, init) => {
            request = { input: String(input), init };
            return Response.json({ ok: true });
        }) as typeof fetch;

        await platformApi.register("new-user", "secret");
        expect(request?.input).toBe("/api/platform/auth/register");
        expect(JSON.parse(String(request?.init?.body))).toEqual({ username: "new-user", password: "secret" });
    });

    test("normalizes project lists and sends the create contract", async () => {
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const responses = [
            Response.json({ projects: [{ project_id: 7, name: "Seven", current_points: 12, permission_ids: [1, 2, 2.5] }] }),
            Response.json(null),
            Response.json({ projects: [{ projectId: "new", name: "New project", points: 0, permissionIds: [] }] }),
        ];
        globalThis.fetch = (async (input, init) => {
            calls.push({ input: String(input), init });
            return responses.shift()!;
        }) as typeof fetch;

        expect(await platformApi.listProjects()).toEqual([{ projectId: "7", name: "Seven", points: 12, permissionIds: [1, 2] }]);
        expect(await platformApi.createProject({ name: "New project", content: "Brief", tag: "design", skill: [0, 2], skillModel: ["model-a"] })).toEqual([{ projectId: "new", name: "New project", points: 0, permissionIds: [] }]);
        expect(calls[0]?.input).toBe("/api/platform/projects");
        expect(calls[1]?.input).toBe("/api/platform/projects");
        expect(calls[2]?.input).toBe("/api/platform/projects");
        expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ name: "New project", content: "Brief", tag: "design", skill: [0, 2], skillModel: ["model-a"] });
    });

    test("selects a URL-encoded project and captures the rotated binding", async () => {
        let request: { input: string; init?: RequestInit } | undefined;
        globalThis.fetch = (async (input, init) => {
            request = { input: String(input), init };
            return Response.json(platformContext(), { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-project-2" } });
        }) as typeof fetch;

        await platformApi.selectProject("project / two");
        expect(request?.input).toBe("/api/platform/projects/project%20%2F%20two/select");
        expect(request?.init?.method).toBe("POST");
        expect(request?.init?.body).toBeUndefined();
        expect(getPlatformSessionBinding()).toBe("binding-project-2");
    });

    test("drops malformed project records", () => {
        expect(normalizePlatformProjects([{ id: "ok", name: "OK", points: Number.POSITIVE_INFINITY, permissionIds: [1, "2"] }, { name: "missing id" }])).toEqual([{ projectId: "ok", name: "OK", points: null, permissionIds: [1] }]);
    });

    test("captures response binding and sends it on following requests", async () => {
        const requests: RequestInit[] = [];
        globalThis.fetch = (async (_input, init) => {
            requests.push(init || {});
            return requests.length === 1 ? Response.json(platformContext(), { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding/login+1" } }) : Response.json(platformContext());
        }) as typeof fetch;

        await platformApi.login("alice", "secret");
        expect(hasPlatformSessionBinding()).toBe(true);
        expect(getPlatformSessionBinding()).toBe("binding/login+1");
        await platformApi.getContext();

        expect(new Headers(requests[1]?.headers).get(CANVAS_SESSION_BINDING_HEADER)).toBe("binding/login+1");
        expect(requests[1]?.credentials).toBe("include");
        expect(hasPlatformSessionBinding()).toBe(false);
    });

    test("clears binding after a successful logout", async () => {
        const responses = [Response.json(platformContext(), { headers: { [CANVAS_SESSION_BINDING_HEADER]: "binding-1" } }), Response.json({ ok: true })];
        globalThis.fetch = (async () => responses.shift()!) as typeof fetch;

        await platformApi.getContext();
        expect(hasPlatformSessionBinding()).toBe(true);
        await platformApi.logout();
        expect(hasPlatformSessionBinding()).toBe(false);
    });

    test("surfaces backend JSON errors with HTTP metadata", async () => {
        globalThis.fetch = (async () => Response.json({ error: { code: "invalid_credentials", message: "Invalid username or password" } }, { status: 401 })) as typeof fetch;

        try {
            await platformApi.getContext();
            throw new Error("Expected request to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(PlatformApiError);
            expect(error).toMatchObject({ message: "Invalid username or password", status: 401, code: "invalid_credentials" });
        }
    });

    test("rejects successful non-JSON responses consistently", async () => {
        globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
        await expect(platformApi.getConfig()).rejects.toMatchObject({ name: "PlatformApiError", message: "Platform returned an invalid JSON response" });
    });

    test("normalizes network failures into a platform API error", async () => {
        globalThis.fetch = (async () => {
            throw new TypeError("Network unavailable");
        }) as typeof fetch;
        await expect(platformApi.getConfig()).rejects.toMatchObject({ name: "PlatformApiError", message: "Network unavailable", status: 0 });
    });
});

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
