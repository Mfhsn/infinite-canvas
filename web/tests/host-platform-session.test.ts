import { describe, expect, test } from "bun:test";

import {
    clearHostPlatformSession,
    HOST_CURRENT_PROJECT_ID_KEY,
    HOST_CURRENT_USER_ID_KEY,
    HOST_EXTERNAL_AUTH_SESSION_KEY,
    HOST_INTEGRATION_SESSION_KEY,
    readHostPlatformSession,
    writeHostCurrentProjectId,
} from "@/services/host-platform-session";

describe("host platform session bridge", () => {
    test("reads the external token and current project from the host platform keys", () => {
        const storage = memoryStorage({
            [HOST_EXTERNAL_AUTH_SESSION_KEY]: JSON.stringify({
                external_token: "host-external-token",
                token_type: "bearer",
                refresh_token: "host-refresh-token",
                profile: { id: "91135892", username: "TestLhs", points: 68288 },
            }),
            [HOST_CURRENT_PROJECT_ID_KEY]: "4",
        });

        expect(readHostPlatformSession(storage)).toEqual({
            externalToken: "host-external-token",
            refreshToken: "host-refresh-token",
            externalProjectId: "4",
        });
    });

    test("rejects malformed or tokenless host sessions", () => {
        expect(readHostPlatformSession(memoryStorage({ [HOST_EXTERNAL_AUTH_SESSION_KEY]: "not-json" }))).toBeNull();
        expect(readHostPlatformSession(memoryStorage({ [HOST_EXTERNAL_AUTH_SESSION_KEY]: JSON.stringify({ profile: { id: "1" } }) }))).toBeNull();
    });

    test("normalizes bearer tokens and can read an explicit project id from the host session", () => {
        const storage = memoryStorage({
            [HOST_EXTERNAL_AUTH_SESSION_KEY]: JSON.stringify({
                external_token: "Bearer host-external-token",
                external_project_id: 17,
            }),
        });

        expect(readHostPlatformSession(storage)).toEqual({
            externalToken: "host-external-token",
            refreshToken: null,
            externalProjectId: "17",
        });
    });

    test("normalizes JSON-wrapped host project ids and ignores malformed object values", () => {
        const session = JSON.stringify({ external_token: "host-external-token" });
        expect(readHostPlatformSession(memoryStorage({
            [HOST_EXTERNAL_AUTH_SESSION_KEY]: session,
            [HOST_CURRENT_PROJECT_ID_KEY]: JSON.stringify({ state: { external_project_id: 27 } }),
        }))).toEqual({ externalToken: "host-external-token", refreshToken: null, externalProjectId: "27" });

        expect(readHostPlatformSession(memoryStorage({
            [HOST_EXTERNAL_AUTH_SESSION_KEY]: session,
            [HOST_CURRENT_PROJECT_ID_KEY]: JSON.stringify({ state: { unrelated: true } }),
        }))).toEqual({ externalToken: "host-external-token", refreshToken: null, externalProjectId: null });
    });

    test("updates the shared current project and clears only host authentication context", () => {
        const storage = memoryStorage({
            [HOST_EXTERNAL_AUTH_SESSION_KEY]: "external",
            [HOST_INTEGRATION_SESSION_KEY]: "integration",
            [HOST_CURRENT_PROJECT_ID_KEY]: "1",
            [HOST_CURRENT_USER_ID_KEY]: "2",
            "ai-comic-unrelated-preference": "keep",
        });

        writeHostCurrentProjectId("9", storage);
        expect(storage.getItem(HOST_CURRENT_PROJECT_ID_KEY)).toBe("9");
        clearHostPlatformSession(storage);
        expect(storage.getItem(HOST_EXTERNAL_AUTH_SESSION_KEY)).toBeNull();
        expect(storage.getItem(HOST_INTEGRATION_SESSION_KEY)).toBeNull();
        expect(storage.getItem(HOST_CURRENT_PROJECT_ID_KEY)).toBeNull();
        expect(storage.getItem(HOST_CURRENT_USER_ID_KEY)).toBeNull();
        expect(storage.getItem("ai-comic-unrelated-preference")).toBe("keep");
    });
});

function memoryStorage(entries: Record<string, string>): Storage {
    const values = new Map(Object.entries(entries));
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => void values.delete(key),
        setItem: (key, value) => void values.set(key, String(value)),
    };
}
